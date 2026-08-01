using System;

namespace JtlSyncEngine.Runtime
{
    /// <summary>
    /// The command line the Sync Engine understands, parsed once at startup.
    /// </summary>
    /// <remarks>
    /// Kept here rather than in the WPF project so it can be unit tested. Argument
    /// handling used to be a private <c>HasArg</c> helper inside <c>App.xaml.cs</c>,
    /// where nothing could reach it — and a startup path that only runs after a server
    /// reboot is exactly the kind of code that needs a test.
    /// </remarks>
    public sealed record StartupArguments
    {
        /// <summary>Launched by Windows at sign-in from the HKCU Run entry.</summary>
        public bool LaunchedAtSignIn { get; init; }

        /// <summary>Explicitly asked to start hidden in the tray.</summary>
        public bool Minimized { get; init; }

        /// <summary>Relaunched by the updater after a successful install.</summary>
        public bool AfterUpdate { get; init; }

        /// <summary>Open on the settings page and start nothing.</summary>
        public bool SafeMode { get; init; }

        /// <summary>Run without a tray icon; the window is the only way back.</summary>
        public bool NoTray { get; init; }

        /// <summary>Ignore a registered service and schedule locally. Development only.</summary>
        public bool ForceStandalone { get; init; }

        public static StartupArguments Parse(string[]? args)
        {
            var values = args ?? Array.Empty<string>();
            var safeMode = Contains(values, "--safe-mode");
            return new StartupArguments
            {
                LaunchedAtSignIn = Contains(values, "--startup"),
                Minimized = Contains(values, "--minimized"),
                AfterUpdate = Contains(values, "--updated"),
                SafeMode = safeMode,
                // Safe mode is for recovering a broken configuration; a tray-only
                // window would hide the very screen the operator needs.
                NoTray = safeMode || Contains(values, "--no-tray"),
                ForceStandalone = Contains(values, "--standalone"),
            };
        }

        private static bool Contains(string[] args, string flag)
        {
            foreach (var arg in args)
            {
                if (arg.Equals(flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }
}
