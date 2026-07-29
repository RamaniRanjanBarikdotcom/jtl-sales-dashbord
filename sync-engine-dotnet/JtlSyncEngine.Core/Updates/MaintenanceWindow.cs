using JtlSyncEngine.Models;

namespace JtlSyncEngine.Updates
{
    public static class MaintenanceWindow
    {
        public static bool IsAllowedNow(
            UpdateSettings settings,
            string installMode,
            DateTimeOffset localNow)
        {
            if (string.Equals(installMode,"now",StringComparison.OrdinalIgnoreCase))
                return true;
            if (!TimeOnly.TryParse(settings.MaintenanceWindowStart,out var start) ||
                !TimeOnly.TryParse(settings.MaintenanceWindowEnd,out var end))
                return false;

            var allowedDays = settings.AllowedDays
                .Select(day => Enum.TryParse<DayOfWeek>(day,true,out var parsed)
                    ? parsed
                    : (DayOfWeek?)null)
                .Where(day => day.HasValue)
                .Select(day => day!.Value)
                .ToHashSet();
            var time = TimeOnly.FromDateTime(localNow.LocalDateTime);
            if (start <= end)
                return allowedDays.Contains(localNow.DayOfWeek) && time >= start && time < end;

            if (time >= start)
                return allowedDays.Contains(localNow.DayOfWeek);
            return time < end &&
                allowedDays.Contains(localNow.AddDays(-1).DayOfWeek);
        }
    }
}
