using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using JtlSyncEngine.Runtime;
using Microsoft.Win32;

namespace JtlSyncEngine.Helpers
{
    /// <summary>
    /// Registers or removes the Windows Service, which is the only way to sync before
    /// anybody logs in.
    /// </summary>
    /// <remarks>
    /// This was called <c>StartupHelper</c> and owned both mechanisms at once, so one
    /// checkbox meant "install a service" and "start at sign-in" simultaneously. It now
    /// does exactly one thing. Starting when the operator signs in — which needs no
    /// administrator approval — belongs to <see cref="PortableStartupManager"/>.
    ///
    /// Registration needs elevation once, so on a server where nobody can answer a UAC
    /// prompt this route is unavailable and the sign-in route is the answer.
    /// </remarks>
    public static class WindowsServiceRegistrationManager
    {
        public const string ServiceName = "JtlSyncEngine";

        private const string ServiceRegistryKey =
            @"SYSTEM\CurrentControlSet\Services\" + ServiceName;

        /// <summary>True when the background service is registered with Windows.</summary>
        public static bool IsServiceInstalled()
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
        public static async Task<StartupChangeResult> SetServiceInstalledAsync(bool enable)
        {
            try
            {
                return await RunServiceToolAsync(
                    enable ? "install-service.ps1" : "uninstall-service.ps1",
                    enable);
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
                // The app itself now runs unelevated. Approval is asked for here and
                // only here — at the moment the operator explicitly asked for a
                // service, not on every launch.
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
                // Raised when the prompt is dismissed — and, on a server whose
                // administrator account has a password, when the operator simply
                // cannot supply one.
                return StartupChangeResult.Failed(
                    "Administrator approval is required to install the background service. " +
                    "If nobody can approve it on this server, use \"Start when I sign in\" instead.");
            }
        }
    }

    public readonly record struct StartupChangeResult(bool Succeeded, string? Error)
    {
        public static StartupChangeResult Ok() => new(true, null);
        public static StartupChangeResult Failed(string error) => new(false, error);
    }
}
