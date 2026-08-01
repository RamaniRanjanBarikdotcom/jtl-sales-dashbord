using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using JtlSyncEngine.Runtime;
using Microsoft.Win32;

namespace JtlSyncEngine.Helpers
{
    /// <summary>
    /// Controls whether syncing survives a server restart.
    /// </summary>
    /// <remarks>
    /// This used to write HKCU\...\Run, which only fires after a user logs in — so
    /// after an unattended server reboot nothing synced until someone signed in and
    /// opened the app. It now registers the Windows Service instead, which starts
    /// before any login. Registration needs administrator rights once.
    /// </remarks>
    public static class StartupHelper
    {
        public const string ServiceName = "JtlSyncEngine";

        private const string LegacyAppName = "JTL-SyncEngine";
        private const string LegacyRunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ServiceRegistryKey =
            @"SYSTEM\CurrentControlSet\Services\" + ServiceName;

        /// <summary>True when the background service is registered with Windows.</summary>
        public static bool IsStartWithWindowsEnabled()
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(ServiceRegistryKey);
                return key != null;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Registers or removes the background service. Shows a UAC prompt.
        /// Returns the tool output so the caller can surface a real failure reason
        /// rather than silently leaving the checkbox in a lying state.
        /// </summary>
        public static async Task<StartupChangeResult> SetStartWithWindowsAsync(bool enable)
        {
            try
            {
                var result = await RunServiceToolAsync(
                    enable ? "install-service.ps1" : "uninstall-service.ps1",
                    enable);

                // The old per-user entry would otherwise keep launching a second copy
                // at login, competing with the service for the scheduler mutex.
                if (result.Succeeded) RemoveLegacyRunEntry();

                return result;
            }
            catch (Exception exception)
            {
                return StartupChangeResult.Failed(exception.Message);
            }
        }

        private static async Task<StartupChangeResult> RunServiceToolAsync(
            string scriptName,
            bool passInstallDirectory)
        {
            var installDirectory = AppContext.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar);
            var script = Path.Combine(installDirectory, "service-tools", scriptName);
            if (!File.Exists(script))
                return StartupChangeResult.Failed(
                    $"Service tool not found: {script}. Re-extract the downloaded ZIP so the service-tools folder is present.");

            var arguments =
                $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"";
            if (passInstallDirectory)
            {
                // Both are passed explicitly: elevation changes what the script would
                // otherwise infer, and %APPDATA% would resolve to the admin's profile.
                arguments +=
                    $" -InstallDirectory \"{installDirectory}\"" +
                    $" -LegacyDataPath \"{RuntimePaths.LegacyRoot.TrimEnd(Path.DirectorySeparatorChar)}\"";
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = arguments,
                UseShellExecute = true,
                Verb = "runas",
            };

            try
            {
                using var process = Process.Start(startInfo);
                if (process == null)
                    return StartupChangeResult.Failed("Unable to start the service tool.");
                await process.WaitForExitAsync();
                return process.ExitCode == 0
                    ? StartupChangeResult.Ok()
                    : StartupChangeResult.Failed(
                        $"{scriptName} failed with exit code {process.ExitCode}.");
            }
            catch (System.ComponentModel.Win32Exception)
            {
                // Raised when the user dismisses the UAC prompt.
                return StartupChangeResult.Failed(
                    "Administrator approval is required to change automatic startup.");
            }
        }

        private static void RemoveLegacyRunEntry()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(LegacyRunKey, writable: true);
                if (key?.GetValue(LegacyAppName) != null)
                    key.DeleteValue(LegacyAppName, throwOnMissingValue: false);
            }
            catch
            {
                // Best effort: a stale Run entry is harmless because the scheduler
                // mutex stops the second instance from syncing anyway.
            }
        }
    }

    public readonly record struct StartupChangeResult(bool Succeeded, string? Error)
    {
        public static StartupChangeResult Ok() => new(true, null);
        public static StartupChangeResult Failed(string error) => new(false, error);
    }
}
