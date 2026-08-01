using System;
using JtlSyncEngine.Runtime;
using Microsoft.Win32;

namespace JtlSyncEngine.Helpers
{
    /// <summary>
    /// Starts the Sync Engine again when the operator signs in, using the per-user Run
    /// key. Needs no administrator approval at any point.
    /// </summary>
    /// <remarks>
    /// This is the answer for servers whose administrator account has a password:
    /// nobody there can answer a UAC prompt, so
    /// <see cref="WindowsServiceRegistrationManager"/> is unavailable and there was
    /// previously no way at all to survive a reboot.
    ///
    /// It is not a replacement for the service. HKCU\...\Run fires only after that user
    /// signs in, so an unattended reboot with nobody logging in still syncs nothing —
    /// see the caution in the plan against promising both "no administrator approval"
    /// and "works before login" for one mode. The UI says which is which.
    ///
    /// Writes only under HKEY_CURRENT_USER, so every operation here works unelevated.
    /// </remarks>
    public static class PortableStartupManager
    {
        /// <summary>
        /// The running executable, not the base directory: under
        /// <c>PublishSingleFile</c> those differ, and the Run entry must name the file
        /// Windows can actually launch.
        /// </summary>
        public static string CurrentExecutablePath =>
            Environment.ProcessPath ??
            System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName ??
            AppContext.BaseDirectory;

        public static bool IsEnabled() => ReadRegisteredCommand() != null;

        public static string? ReadRegisteredCommand()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    PortableStartupCommand.RunKeyPath);
                var value = key?.GetValue(PortableStartupCommand.RegistryValueName) as string;
                return string.IsNullOrWhiteSpace(value) ? null : value;
            }
            catch
            {
                return null;
            }
        }

        public static StartupChangeResult Enable() => Enable(CurrentExecutablePath);

        public static StartupChangeResult Enable(string executablePath)
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(
                    PortableStartupCommand.RunKeyPath, writable: true);
                if (key == null)
                    return StartupChangeResult.Failed(
                        "Windows did not allow the per-user startup key to be opened.");

                key.SetValue(
                    PortableStartupCommand.RegistryValueName,
                    PortableStartupCommand.Build(executablePath),
                    RegistryValueKind.String);
                return StartupChangeResult.Ok();
            }
            catch (Exception exception)
            {
                // Reported, never swallowed: a checkbox that silently failed to stick
                // is what left servers dead after a reboot in the first place.
                return StartupChangeResult.Failed(
                    $"Could not register automatic startup: {exception.Message}");
            }
        }

        public static StartupChangeResult Disable()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    PortableStartupCommand.RunKeyPath, writable: true);
                key?.DeleteValue(
                    PortableStartupCommand.RegistryValueName,
                    throwOnMissingValue: false);
                return StartupChangeResult.Ok();
            }
            catch (Exception exception)
            {
                return StartupChangeResult.Failed(
                    $"Could not remove automatic startup: {exception.Message}");
            }
        }

        /// <summary>
        /// Rewrites the entry when it no longer points at this build. Returns true only
        /// when something was actually repaired.
        /// </summary>
        /// <remarks>
        /// Portable folders get moved — extracted to the desktop, then relocated to a
        /// data drive. The old entry then launches nothing, and the next reboot looks
        /// exactly like "automatic startup does not work".
        /// </remarks>
        public static bool RepairIfStale(out string? error)
        {
            error = null;
            var registered = ReadRegisteredCommand();
            if (registered == null) return false;

            var current = CurrentExecutablePath;
            if (!PortableStartupCommand.NeedsRepair(registered, current)) return false;

            var result = Enable(current);
            if (result.Succeeded) return true;

            error = result.Error;
            return false;
        }
    }
}
