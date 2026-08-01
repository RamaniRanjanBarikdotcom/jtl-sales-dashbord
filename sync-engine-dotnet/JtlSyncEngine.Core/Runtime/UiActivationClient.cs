using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace JtlSyncEngine.Runtime
{
    /// <summary>
    /// Asks an already-running copy of the Sync Engine to show its window.
    /// </summary>
    public static class UiActivationClient
    {
        /// <summary>
        /// Returns true only when the running copy confirmed it is showing itself.
        /// Never throws: the first instance may be shutting down, mid-update, or from
        /// an older build with no listener, and the caller still has to decide what to
        /// do next.
        /// </summary>
        public static async Task<bool> TryActivateAsync(
            string pipeName,
            TimeSpan timeout,
            CancellationToken cancellationToken = default)
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(timeout);

            try
            {
                using var pipe = new NamedPipeClientStream(
                    ".",
                    pipeName,
                    PipeDirection.InOut,
                    PipeOptions.Asynchronous,
                    // Required so the listener can confirm the caller is the same
                    // Windows account before obeying.
                    System.Security.Principal.TokenImpersonationLevel.Identification);
                await pipe.ConnectAsync(timeoutCts.Token);

                using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
                {
                    AutoFlush = true,
                };
                using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);

                await writer.WriteLineAsync(UiActivationProtocol.ActivateCommand);
                var response = await reader.ReadLineAsync(timeoutCts.Token);
                return string.Equals(
                    response?.Trim(),
                    UiActivationProtocol.AcknowledgedResponse,
                    StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }
    }
}
