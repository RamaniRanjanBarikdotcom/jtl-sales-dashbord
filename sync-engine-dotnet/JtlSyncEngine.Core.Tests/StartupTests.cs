using JtlSyncEngine.Ipc;
using JtlSyncEngine.Runtime;
using Xunit;

namespace JtlSyncEngine.Core.Tests;

/// <summary>
/// Covers the code that only ever runs after a server reboot, or on a second
/// double-click — the two paths nobody watches and that were reported broken in
/// production.
/// </summary>
public sealed class StartupTests
{
    // ── StartupArguments ────────────────────────────────────────────────────

    [Fact]
    public void StartupArguments_TreatsNoArgumentsAsAManualLaunch()
    {
        var parsed = StartupArguments.Parse(Array.Empty<string>());

        Assert.False(parsed.LaunchedAtSignIn);
        Assert.False(parsed.Minimized);
        Assert.False(parsed.SafeMode);
        Assert.False(parsed.NoTray);
        Assert.False(parsed.ForceStandalone);
        Assert.False(parsed.AfterUpdate);
    }

    [Fact]
    public void StartupArguments_TolerateANullCommandLine()
    {
        // Parse runs before anything else in OnStartup. An exception here would show
        // as "the app does not open at all" with no log to explain it.
        var parsed = StartupArguments.Parse(null);

        Assert.False(parsed.LaunchedAtSignIn);
    }

    [Fact]
    public void StartupArguments_RecognisesTheSignInFlagWrittenIntoTheRunKey()
    {
        // The exact string PortableStartupCommand.Build emits. If these two ever drift,
        // every sign-in launch is silently mistaken for a manual double-click and the
        // startup delay and notification are skipped.
        var parsed = StartupArguments.Parse(
            new[] { PortableStartupCommand.SignInFlag });

        Assert.True(parsed.LaunchedAtSignIn);
    }

    [Fact]
    public void StartupArguments_IgnoreFlagCasing()
    {
        var parsed = StartupArguments.Parse(new[] { "--STARTUP", "--Minimized" });

        Assert.True(parsed.LaunchedAtSignIn);
        Assert.True(parsed.Minimized);
    }

    [Fact]
    public void StartupArguments_SafeModeAlsoDisablesTheTray()
    {
        // Safe mode exists to fix a broken configuration. Hiding the window in the tray
        // would hide the only screen that can fix it.
        var parsed = StartupArguments.Parse(new[] { "--safe-mode" });

        Assert.True(parsed.SafeMode);
        Assert.True(parsed.NoTray);
    }

    [Fact]
    public void StartupArguments_IgnoreUnknownFlags()
    {
        var parsed = StartupArguments.Parse(new[] { "--startup", "--not-a-real-flag" });

        Assert.True(parsed.LaunchedAtSignIn);
        Assert.False(parsed.SafeMode);
    }

    // ── PortableStartupCommand ──────────────────────────────────────────────

    [Fact]
    public void PortableStartupCommand_QuotesThePathSoSpacesDoNotSplitIt()
    {
        var command = PortableStartupCommand.Build(@"C:\JTL Sync Engine\JtlSyncEngine.exe");

        Assert.Equal(
            "\"C:\\JTL Sync Engine\\JtlSyncEngine.exe\" --startup",
            command);
    }

    [Fact]
    public void PortableStartupCommand_RejectsAnEmptyPath()
    {
        // A blank entry would register successfully and then launch nothing, which is
        // indistinguishable from automatic startup never having been switched on.
        Assert.Throws<ArgumentException>(() => PortableStartupCommand.Build("   "));
    }

    [Fact]
    public void PortableStartupCommand_RoundTripsThePathItWrote()
    {
        const string path = @"C:\JTL Sync Engine\JtlSyncEngine.exe";

        var extracted = PortableStartupCommand.TryExtractExecutablePath(
            PortableStartupCommand.Build(path));

        Assert.Equal(path, extracted);
    }

    [Fact]
    public void PortableStartupCommand_ReadsAnUnquotedPathContainingSpaces()
    {
        // What an older build or a hand edit leaves behind.
        var extracted = PortableStartupCommand.TryExtractExecutablePath(
            @"C:\JTL Sync\JtlSyncEngine.exe --startup");

        Assert.Equal(@"C:\JTL Sync\JtlSyncEngine.exe", extracted);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void PortableStartupCommand_ReportsNoPathRatherThanGuessing(string? command)
    {
        Assert.Null(PortableStartupCommand.TryExtractExecutablePath(command));
    }

    [Fact]
    public void PortableStartupCommand_LeavesACorrectEntryAlone()
    {
        const string path = @"C:\JTL\JtlSyncEngine.exe";

        Assert.False(PortableStartupCommand.NeedsRepair(
            PortableStartupCommand.Build(path),
            path));
    }

    [Fact]
    public void PortableStartupCommand_IgnoresDriveLetterCasing()
    {
        Assert.False(PortableStartupCommand.NeedsRepair(
            "\"c:\\jtl\\jtlsyncengine.exe\" --startup",
            @"C:\JTL\JtlSyncEngine.exe"));
    }

    [Fact]
    public void PortableStartupCommand_RepairsAnEntryLeftBehindByAMovedFolder()
    {
        // The reported failure: extract to the desktop, enable startup, move the folder
        // to a data drive, reboot — and nothing happens, with no error anywhere.
        Assert.True(PortableStartupCommand.NeedsRepair(
            "\"C:\\Users\\Admin\\Desktop\\JTL\\JtlSyncEngine.exe\" --startup",
            @"D:\Apps\JTL\JtlSyncEngine.exe"));
    }

    [Fact]
    public void PortableStartupCommand_RepairsAnEntryMissingTheSignInFlag()
    {
        const string path = @"C:\JTL\JtlSyncEngine.exe";

        Assert.True(PortableStartupCommand.NeedsRepair($"\"{path}\"", path));
    }

    [Fact]
    public void PortableStartupCommand_TreatsAnUnreadableEntryAsNeedingRepair()
    {
        Assert.True(PortableStartupCommand.NeedsRepair("\"\" --startup", @"C:\JTL\app.exe"));
    }

    [Fact]
    public void PortableStartupCommand_DoesNotInventAnEntryWhenNoneExists()
    {
        // Repair must never enable startup on its own. The operator decides that.
        Assert.False(PortableStartupCommand.NeedsRepair(null, @"C:\JTL\app.exe"));
        Assert.False(PortableStartupCommand.NeedsRepair("   ", @"C:\JTL\app.exe"));
    }

    // ── UiActivationProtocol ────────────────────────────────────────────────

    [Fact]
    public void ActivationPipeName_IsStableForTheSameUserAndSession()
    {
        var first = UiActivationProtocol.PipeNameForUser("S-1-5-21-1-2-3-1001", 2);
        var second = UiActivationProtocol.PipeNameForUser("S-1-5-21-1-2-3-1001", 2);

        Assert.Equal(first, second);
    }

    [Fact]
    public void ActivationPipeName_SeparatesDifferentUsers()
    {
        // Otherwise one operator's double-click would pull another operator's window
        // forward in their session.
        Assert.NotEqual(
            UiActivationProtocol.PipeNameForUser("S-1-5-21-1-2-3-1001", 1),
            UiActivationProtocol.PipeNameForUser("S-1-5-21-1-2-3-1002", 1));
    }

    [Fact]
    public void ActivationPipeName_SeparatesSessionsOfTheSameUser()
    {
        // The single-instance mutex is Local\-scoped, so the same account signed in
        // twice legitimately runs two copies. They cannot share one pipe name.
        Assert.NotEqual(
            UiActivationProtocol.PipeNameForUser("S-1-5-21-1-2-3-1001", 1),
            UiActivationProtocol.PipeNameForUser("S-1-5-21-1-2-3-1001", 2));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ActivationPipeName_StillProducesAUsableNameWithoutASid(string? sid)
    {
        var name = UiActivationProtocol.PipeNameForUser(sid, 1);

        Assert.StartsWith(UiActivationProtocol.PipeNamePrefix, name);
        Assert.DoesNotContain('\\', name);
    }

    [Fact]
    public void ActivationPipeName_NeverContainsAPathSeparator()
    {
        // A backslash separates the server from the pipe path, so unexpected input must
        // not be able to point the channel at another machine.
        var name = UiActivationProtocol.PipeNameForUser(@"CONTOSO\admin S-1-5-18", 0);

        Assert.DoesNotContain('\\', name);
        Assert.DoesNotContain('/', name);
        Assert.DoesNotContain(' ', name);
    }

    // ── Control pipe authorization under an unelevated token ────────────────

    [Fact]
    public void ControlPipe_RecognisesAnAdministratorWhoseTokenIsFiltered()
    {
        // The app now runs asInvoker, so WindowsPrincipal.IsInRole(Administrator) is
        // false for an administrator who has not elevated. The Administrators SID is
        // still present in the token as deny-only, and that is what this reads.
        Assert.True(NamedPipeControlServer.IsAdministratorsGroupMember(
            new[] { "S-1-1-0", "S-1-5-32-544", "S-1-5-11" }));
    }

    [Fact]
    public void ControlPipe_DoesNotTreatAnOrdinaryUserAsAnAdministrator()
    {
        Assert.False(NamedPipeControlServer.IsAdministratorsGroupMember(
            new[] { "S-1-1-0", "S-1-5-11", "S-1-5-32-545" }));
    }

    [Fact]
    public void ControlPipe_DoesNotTreatAnEmptyGroupListAsAnAdministrator()
    {
        Assert.False(NamedPipeControlServer.IsAdministratorsGroupMember(
            Array.Empty<string>()));
    }
}
