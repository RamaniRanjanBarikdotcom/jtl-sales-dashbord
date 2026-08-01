using System;
using System.Text;

namespace JtlSyncEngine.Runtime
{
    /// <summary>
    /// Names the private channel a second launch uses to ask the already-running copy
    /// to show its window.
    /// </summary>
    /// <remarks>
    /// Before this existed, double-clicking the executable while the app sat in the
    /// tray did nothing at all: the second process saw the single-instance mutex and
    /// exited without a word, so the app looked broken. That is the "it does not open"
    /// half of the reboot complaint.
    ///
    /// Deliberately separate from the service control pipe. That pipe carries settings
    /// and sync commands and is restricted to administrators; this one only says
    /// "come to the front" and must work for whoever is signed in.
    /// </remarks>
    public static class UiActivationProtocol
    {
        public const string PipeNamePrefix = "JtlSyncEngine.UI.Activation.";

        /// <summary>The only message the channel carries.</summary>
        public const string ActivateCommand = "activate";

        public const string AcknowledgedResponse = "ok";

        /// <summary>
        /// One channel per Windows session, named after the user who owns it.
        /// </summary>
        /// <remarks>
        /// The SID keeps one operator from pulling another operator's window forward.
        /// The session id is needed as well because the single-instance mutex is
        /// <c>Local\</c>-scoped, i.e. per session: on a server where the same account
        /// is signed in twice, each session legitimately runs its own copy, and two
        /// copies cannot share one pipe name.
        /// </remarks>
        public static string PipeNameForUser(string? userSid, int sessionId = 0)
        {
            var sid = (userSid ?? string.Empty).Trim();
            // A missing SID must not collapse every session onto one shared name; that
            // would let one user's launch pull another user's window forward.
            if (sid.Length == 0) sid = "unknown";
            return $"{PipeNamePrefix}{Sanitize(sid)}.{sessionId}";
        }

        /// <summary>
        /// Pipe names may not contain a backslash — that character separates the
        /// server from the pipe path — and unexpected input must not be able to
        /// redirect the channel somewhere else.
        /// </summary>
        private static string Sanitize(string value)
        {
            var builder = new StringBuilder(value.Length);
            foreach (var character in value)
            {
                builder.Append(
                    char.IsLetterOrDigit(character) || character == '-' || character == '_'
                        ? character
                        : '_');
            }
            return builder.ToString();
        }
    }
}
