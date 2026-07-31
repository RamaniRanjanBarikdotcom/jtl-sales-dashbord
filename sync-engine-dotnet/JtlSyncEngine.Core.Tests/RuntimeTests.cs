using System.Security.Cryptography;
using JtlSyncEngine.Ipc;
using JtlSyncEngine.Runtime;
using Xunit;

namespace JtlSyncEngine.Core.Tests;

public sealed class RuntimeTests
{
    [Fact]
    public void SchedulerOwnership_AllowsOnlyOneOwner()
    {
        var name = $"JtlSyncEngine-Test-{Guid.NewGuid():N}";
        using var first = new SchedulerOwnership(name);
        using var second = new SchedulerOwnership(name);
        var competitorAcquired = true;
        var competitor = new Thread(() => competitorAcquired = second.TryAcquire());

        Assert.True(first.TryAcquire());
        competitor.Start();
        competitor.Join();
        Assert.False(competitorAcquired);
        first.Release();
        Assert.True(second.TryAcquire());
    }

    [Fact]
    public void SchedulerOwnership_IsHandedOverOnlyAfterTheHolderReleases()
    {
        // The portable UI owns the mutex until "Start automatically with Windows" is
        // ticked. If it did not release, the freshly registered service would start,
        // silently fail to acquire, and sync nothing until the next reboot.
        var name = $"JtlSyncEngine-Test-{Guid.NewGuid():N}";
        using var portableApp = new SchedulerOwnership(name);
        var service = new SchedulerOwnership(name);
        using var firstAttemptDone = new ManualResetEventSlim(false);
        using var handedOver = new ManualResetEventSlim(false);

        Assert.True(portableApp.TryAcquire());

        // A Windows mutex is thread-affine, so the competing acquisition — and any
        // matching release — must both happen on that same separate thread.
        var acquiredWhileHeld = false;
        var acquiredAfterRelease = false;
        var contender = new Thread(() =>
        {
            acquiredWhileHeld = service.TryAcquire();
            firstAttemptDone.Set();
            handedOver.Wait();
            acquiredAfterRelease = service.TryAcquire();
            service.Dispose();
        });
        contender.Start();

        // Release only after the contended attempt, otherwise the thread could be
        // scheduled late and acquire a mutex that was already free.
        firstAttemptDone.Wait();
        portableApp.Release();
        handedOver.Set();
        contender.Join();

        Assert.False(acquiredWhileHeld);
        Assert.True(acquiredAfterRelease);
    }

    [Fact]
    public async Task ControlClient_FailsQuicklyWhenServiceIsUnavailable()
    {
        var client = new NamedPipeControlClient();
        await Assert.ThrowsAnyAsync<Exception>(() =>
            client.SendAsync(
                new ServiceControlRequest { Command = "GetStatus" },
                TimeSpan.FromMilliseconds(100)));
    }

    [Fact]
    public void Protocol_IsVersioned()
    {
        Assert.Equal(1, ServiceControlProtocol.ProtocolVersion);
        Assert.Equal(
            ServiceControlProtocol.ProtocolVersion,
            new ServiceControlRequest().ProtocolVersion);
    }

    [Fact]
    public void PipeAuthorization_RejectsUnapprovedIdentity()
    {
        Assert.False(NamedPipeControlServer.IsIdentityAuthorized(
            @"EXAMPLE\unapproved",
            false,
            new[] { @"EXAMPLE\sync-admin" }));
    }

    [Theory]
    [InlineData(true, @"EXAMPLE\unapproved")]
    [InlineData(false, @"EXAMPLE\sync-admin")]
    public void PipeAuthorization_AllowsAdministratorOrConfiguredIdentity(
        bool isAdministrator,
        string identity)
    {
        Assert.True(NamedPipeControlServer.IsIdentityAuthorized(
            identity,
            isAdministrator,
            new[] { @"EXAMPLE\sync-admin" }));
    }

    [Fact]
    public void PipeAuthorization_AllowsTheServiceIdentityForSelfHealthCheck()
    {
        Assert.True(NamedPipeControlServer.IsIdentityAuthorized(
            @"NT AUTHORITY\LOCAL SERVICE",
            false,
            Array.Empty<string>(),
            @"NT AUTHORITY\LOCAL SERVICE"));
    }
}

/// <summary>
/// The portable app and the background service must not share a data root or a DPAPI
/// scope. Getting this wrong is what leaves a freshly registered service unable to
/// decrypt the credentials the app wrote, so it starts and then syncs nothing.
/// </summary>
[Collection(nameof(RuntimeModeTests))]
public sealed class RuntimeModeTests : IDisposable
{
    private const string ModeVariable = "JTL_SYNC_RUNTIME_MODE";
    private readonly string? _originalMode =
        Environment.GetEnvironmentVariable(ModeVariable);

    public void Dispose() =>
        Environment.SetEnvironmentVariable(ModeVariable, _originalMode);

    [Fact]
    public void ServiceMode_UsesMachineWideRootAndScope()
    {
        Environment.SetEnvironmentVariable(ModeVariable, "service");

        Assert.True(RuntimePaths.IsServiceMode);
        Assert.Equal(RuntimePaths.ServiceRoot, RuntimePaths.CurrentRoot);
        // A per-user root would be unreadable by the service account, and a
        // CurrentUser scope would be undecryptable before anyone logs in.
        Assert.Equal(DataProtectionScope.LocalMachine, RuntimePaths.SecretScope);
    }

    [Fact]
    public void PortableMode_UsesPerUserRootAndScope()
    {
        Environment.SetEnvironmentVariable(ModeVariable, null);

        Assert.False(RuntimePaths.IsServiceMode);
        Assert.Equal(RuntimePaths.LegacyRoot, RuntimePaths.CurrentRoot);
        Assert.Equal(DataProtectionScope.CurrentUser, RuntimePaths.SecretScope);
    }

    [Fact]
    public void ServiceAndPortableRootsNeverCollide()
    {
        Assert.NotEqual(RuntimePaths.ServiceRoot, RuntimePaths.LegacyRoot);
    }

    [Fact]
    public void OnlyTheExactServiceValueSwitchesMode()
    {
        // Guards against a partial value silently selecting the wrong data root.
        Environment.SetEnvironmentVariable(ModeVariable, "services");
        Assert.False(RuntimePaths.IsServiceMode);

        Environment.SetEnvironmentVariable(ModeVariable, "SERVICE");
        Assert.True(RuntimePaths.IsServiceMode);
    }

    [Fact]
    public void TheServiceDecidesOnItsOwnCredentialsNotThePerUserFolder()
    {
        // Regression: the service runs as LocalService, where the per-user path
        // resolves to C:\Windows\ServiceProfiles\LocalService\... rather than the
        // operator's profile. Judging migration from there made the service log
        // "migration required" forever while working credentials sat in ProgramData.
        Environment.SetEnvironmentVariable(ModeVariable, "service");

        // The file it depends on must live in the machine-wide store, never under a
        // user profile — that is precisely the distinction the defect got wrong.
        var deciding = ServiceConfigurationGuard.ServiceSecretsPath;
        Assert.StartsWith(RuntimePaths.ServiceRoot, deciding);
        Assert.DoesNotContain(RuntimePaths.LegacyRoot, deciding);

        // And the decision must be exactly "does that file exist", so a per-user
        // folder can no longer keep the service blocked.
        Assert.Equal(!File.Exists(deciding), ServiceConfigurationGuard.RequiresUserContextMigration());
    }

    [Fact]
    public void LegacyDataIsMigratedOnlyWhenTheServiceHasNoCredentialsYet()
    {
        // install-service.ps1 re-encrypts the operator's secrets for the machine
        // before the first start; without it the service can decrypt nothing.
        Assert.True(LegacyDataNeedsMigration(legacySecrets: true, serviceSecrets: false, marker: false));

        // Already migrated, or a fresh install with no legacy data at all.
        Assert.False(LegacyDataNeedsMigration(legacySecrets: true, serviceSecrets: true, marker: false));
        Assert.False(LegacyDataNeedsMigration(legacySecrets: true, serviceSecrets: false, marker: true));
        Assert.False(LegacyDataNeedsMigration(legacySecrets: false, serviceSecrets: false, marker: false));
    }

    private static bool LegacyDataNeedsMigration(bool legacySecrets, bool serviceSecrets, bool marker)
    {
        var root = Path.Combine(Path.GetTempPath(), $"jtl-guard-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var legacyPath = Path.Combine(root, "legacy-secrets.dat");
            var servicePath = Path.Combine(root, "service-secrets.dat");
            var markerPath = Path.Combine(root, "migration-v1.complete");
            if (legacySecrets) File.WriteAllText(legacyPath, "encrypted");
            if (serviceSecrets) File.WriteAllText(servicePath, "encrypted");
            if (marker) File.WriteAllText(markerPath, "migrationVersion=1");

            return ServiceConfigurationGuard.LegacyDataNeedsMigration(
                legacyPath, servicePath, markerPath);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void MigrationMarkerLivesUnderTheServiceRoot()
    {
        // A marker under the per-user root would be invisible to the service and the
        // migration would appear to be pending forever.
        Assert.StartsWith(RuntimePaths.ServiceRoot, ServiceConfigurationGuard.MigrationMarker);
        Assert.DoesNotContain(RuntimePaths.LegacyRoot, ServiceConfigurationGuard.MigrationMarker);
    }
}
