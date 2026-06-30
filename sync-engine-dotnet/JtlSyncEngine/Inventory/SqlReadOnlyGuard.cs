using System;
using System.Text.RegularExpressions;

namespace JtlSyncEngine.Inventory
{
    public static class SqlReadOnlyGuard
    {
        private static readonly Regex BlockedTokenPattern = new(
            @"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE)\b|\b(xp_|sp_)\w+",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public static void EnsureReadOnly(string sql)
        {
            var normalized = StripLeadingComments(sql).TrimStart();
            if (string.IsNullOrWhiteSpace(normalized))
                throw new InvalidOperationException("Blocked empty SQL command.");

            if (!normalized.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) &&
                !normalized.StartsWith("WITH", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Blocked non-read-only SQL command. Only SELECT/WITH is allowed.");
            }

            if (BlockedTokenPattern.IsMatch(normalized))
                throw new InvalidOperationException("Blocked unsafe SQL token in read-only JTL query.");
        }

        private static string StripLeadingComments(string sql)
        {
            var text = sql ?? "";
            while (true)
            {
                var trimmed = text.TrimStart();
                if (trimmed.StartsWith("--", StringComparison.Ordinal))
                {
                    var nextLine = trimmed.IndexOf('\n');
                    text = nextLine >= 0 ? trimmed[(nextLine + 1)..] : "";
                    continue;
                }

                if (trimmed.StartsWith("/*", StringComparison.Ordinal))
                {
                    var end = trimmed.IndexOf("*/", StringComparison.Ordinal);
                    text = end >= 0 ? trimmed[(end + 2)..] : "";
                    continue;
                }

                return trimmed;
            }
        }
    }
}
