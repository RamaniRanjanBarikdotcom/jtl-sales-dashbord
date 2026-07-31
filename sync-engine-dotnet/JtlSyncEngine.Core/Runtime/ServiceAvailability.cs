using System;
using System.Threading;
using System.Threading.Tasks;

namespace JtlSyncEngine.Runtime
{
    /// <summary>
    /// Decides whether the management UI should hand control to the background service
    /// or run the scheduler itself.
    /// </summary>
    /// <remarks>
    /// Registration alone is not enough. A service can be registered but stopped,
    /// blocked on missing credentials, or running an older build that never answers.
    /// Treating "registered" as "in charge" left the UI routing every save, connection
    /// test and manual sync down a pipe nobody was listening on, so the app worked but
    /// could do nothing.
    /// </remarks>
    public static class ServiceAvailability
    {
        /// <summary>
        /// True only when the service is registered AND answering on the control pipe.
        /// </summary>
        public static bool ShouldDeferToService(bool isRegistered, bool isResponding) =>
            isRegistered && isResponding;

        /// <summary>
        /// Probes the control pipe, treating any failure as "not responding". Never
        /// throws: an unreachable service is an expected state, not an error.
        /// </summary>
        public static async Task<bool> IsRespondingAsync(
            Func<CancellationToken, Task<bool>> probe,
            TimeSpan timeout,
            CancellationToken cancellationToken = default)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(timeout);
            try
            {
                return await probe(cts.Token).ConfigureAwait(false);
            }
            catch
            {
                return false;
            }
        }
    }
}
