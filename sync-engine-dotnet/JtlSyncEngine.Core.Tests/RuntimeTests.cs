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
}
