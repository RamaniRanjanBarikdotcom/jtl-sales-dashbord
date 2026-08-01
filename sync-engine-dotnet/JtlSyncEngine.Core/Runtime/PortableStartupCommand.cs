using System;

namespace JtlSyncEngine.Runtime
{
    /// <summary>
    /// Builds and reads the command line stored in the per-user Run key, which is how
    /// the portable Sync Engine starts again after a reboot without administrator
    /// approval.
    /// </summary>
    /// <remarks>
    /// Pure string handling on purpose: the registry itself is touched by
    /// <c>PortableStartupManager</c> in the WPF project, which cannot be unit tested on
    /// a build agent. Everything that can actually be wrong — quoting, a stale path
    /// after the portable folder was moved — is decided here, where tests can reach it.
    /// </remarks>
    public static class PortableStartupCommand
    {
        /// <summary>Value name under HKCU\Software\Microsoft\Windows\CurrentVersion\Run.</summary>
        public const string RegistryValueName = "JTL-SyncEngine";

        public const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

        /// <summary>
        /// Marks a launch as coming from Windows sign-in rather than a double-click.
        /// </summary>
        public const string SignInFlag = "--startup";

        /// <summary>
        /// Quoted so a path containing spaces — <c>C:\Program Files\...</c> or a user
        /// folder with a space in it — is not split into two arguments by Windows.
        /// </summary>
        /// <remarks>
        /// <c>--minimized</c> is deliberately NOT added. Whether the window appears is
        /// the operator's "Start minimized" setting; hard-coding it here meant a server
        /// came back from a reboot with nothing visible at all, which reads as "it did
        /// not start".
        /// </remarks>
        public static string Build(string executablePath)
        {
            var path = (executablePath ?? string.Empty).Trim().Trim('"');
            if (path.Length == 0)
                throw new ArgumentException(
                    "A startup entry needs the full path to the executable.",
                    nameof(executablePath));

            return $"\"{path}\" {SignInFlag}";
        }

        /// <summary>
        /// Recovers the executable path from a registered command, accepting the
        /// unquoted form an older build or a hand edit may have left behind.
        /// </summary>
        public static string? TryExtractExecutablePath(string? command)
        {
            var text = (command ?? string.Empty).Trim();
            if (text.Length == 0) return null;

            if (text[0] == '"')
            {
                var closing = text.IndexOf('"', 1);
                if (closing <= 1) return null;
                var quoted = text.Substring(1, closing - 1).Trim();
                return quoted.Length == 0 ? null : quoted;
            }

            // Unquoted: everything up to the first switch, so "C:\JTL Sync\app.exe
            // --startup" still resolves even though the path contains a space.
            var flag = text.IndexOf(" --", StringComparison.Ordinal);
            var bare = (flag >= 0 ? text[..flag] : text).Trim();
            return bare.Length == 0 ? null : bare;
        }

        /// <summary>
        /// True when the registered entry points somewhere other than this build, so
        /// the caller should rewrite it.
        /// </summary>
        /// <remarks>
        /// A portable app gets moved: the operator extracts the ZIP to the desktop,
        /// then relocates it to D:\Apps. The old entry then launches nothing at all and
        /// the server comes back from a reboot silently dead — the failure mode this
        /// whole class exists to prevent.
        /// </remarks>
        public static bool NeedsRepair(string? registeredCommand, string currentExecutablePath)
        {
            if (string.IsNullOrWhiteSpace(registeredCommand)) return false;

            var registeredPath = TryExtractExecutablePath(registeredCommand);
            if (registeredPath == null) return true;

            if (!PathsMatch(registeredPath, currentExecutablePath)) return true;

            // The path is right but the flag is missing — an entry written by an older
            // build. Rewriting it is what makes the sign-in launch distinguishable
            // from a manual double-click.
            return !registeredCommand.Contains(SignInFlag, StringComparison.OrdinalIgnoreCase);
        }

        private static bool PathsMatch(string left, string right) =>
            string.Equals(Normalize(left), Normalize(right), StringComparison.OrdinalIgnoreCase);

        private static string Normalize(string path) =>
            (path ?? string.Empty).Trim().Trim('"').TrimEnd('\\', '/');
    }
}
