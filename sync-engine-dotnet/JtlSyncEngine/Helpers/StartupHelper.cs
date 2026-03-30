using System;
using Microsoft.Win32;

namespace JtlSyncEngine.Helpers
{
    public static class StartupHelper
    {
        private const string AppName = "JTL-SyncEngine";
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public static void SetStartWithWindows(bool enable)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
                if (key == null) return;

                if (enable)
                {
                    var exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                    // Replace .dll with .exe for published single-file or standard WPF exe
                    if (exePath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                        exePath = exePath[..^4] + ".exe";

                    key.SetValue(AppName, $"\"{exePath}\" --minimized");
                }
                else
                {
                    if (key.GetValue(AppName) != null)
                        key.DeleteValue(AppName, throwOnMissingValue: false);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"StartupHelper error: {ex.Message}");
            }
        }

        public static bool IsStartWithWindowsEnabled()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
                return key?.GetValue(AppName) != null;
            }
            catch
            {
                return false;
            }
        }
    }
}
