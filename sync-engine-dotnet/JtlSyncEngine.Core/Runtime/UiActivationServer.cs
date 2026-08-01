using System;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace JtlSyncEngine.Runtime
{
    /// <summary>
    /// Listens for "show yourself" requests from a second launch of the executable.
    /// </summary>
    /// <remarks>
    /// See <see cref="UiActivationProtocol"/> for why this exists and why it is not
    /// the service control pipe.
    /// </remarks>
    public sealed class UiActivationServer : IAsyncDisposable
    {
        private readonly string _pipeName;
        private readonly Func<Task> _onActivationRequested;
        private readonly Action<string, Exception?>? _onError;
        private readonly CancellationTokenSource _shutdown = new();
        private CancellationTokenSource? _linked;
        private Task? _listener;

        public UiActivationServer(
            string pipeName,
            Func<Task> onActivationRequested,
            Action<string, Exception?>? onError = null)
        {
            _pipeName = pipeName;
            _onActivationRequested = onActivationRequested;
            _onError = onError;
        }

        public void Start(CancellationToken cancellationToken = default)
        {
            if (_listener != null) return;
            _linked = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken,
                _shutdown.Token);

            // Task.Run, not a bare call: Start() is invoked from the WPF UI thread, and
            // a bare call would capture the dispatcher as its synchronization context.
            // The listener would then need the UI thread to make progress — so a shutdown
            // that waits for it from the UI thread would deadlock, and any UI-thread stall
            // would stop the app answering activation requests.
            var token = _linked.Token;
            _listener = Task.Run(() => ListenAsync(token), CancellationToken.None);
        }

        private async Task ListenAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await using var pipe = new NamedPipeServerStream(
                        _pipeName,
                        PipeDirection.InOut,
                        1,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous);

                    await pipe.WaitForConnectionAsync(cancellationToken);
                    await HandleAsync(pipe, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception exception)
                {
                    // A failed activation must never take down the running app; the
                    // engine is mid-sync behind this listener.
                    _onError?.Invoke("UI activation listener error", exception);
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                }
            }
        }

        private async Task HandleAsync(
            NamedPipeServerStream pipe,
            CancellationToken cancellationToken)
        {
            using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true,
            };

            if (!IsSameUser(pipe))
            {
                await writer.WriteLineAsync("denied");
                return;
            }

            var message = await reader.ReadLineAsync(cancellationToken);
            if (!string.Equals(
                    message?.Trim(),
                    UiActivationProtocol.ActivateCommand,
                    StringComparison.OrdinalIgnoreCase))
            {
                await writer.WriteLineAsync("unsupported");
                return;
            }

            await _onActivationRequested();
            await writer.WriteLineAsync(UiActivationProtocol.AcknowledgedResponse);
        }

        /// <summary>
        /// The pipe name already carries the owner's SID, but a name is not a
        /// permission. Only the same Windows account may bring this window forward.
        /// </summary>
        private bool IsSameUser(NamedPipeServerStream pipe)
        {
            if (!OperatingSystem.IsWindows()) return true;
            try
            {
                var caller = pipe.GetImpersonationUserName();
                var owner = WindowsIdentity.GetCurrent()?.Name;
                return !string.IsNullOrWhiteSpace(owner) &&
                       string.Equals(caller, owner, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception exception)
            {
                _onError?.Invoke("Could not identify the activation caller", exception);
                return false;
            }
        }

        public async ValueTask DisposeAsync()
        {
            _shutdown.Cancel();
            if (_listener != null)
            {
                try { await _listener; }
                catch (OperationCanceledException) { }
                catch (Exception exception)
                {
                    _onError?.Invoke("UI activation listener shutdown error", exception);
                }
                _listener = null;
            }
            _linked?.Dispose();
            _linked = null;
            _shutdown.Dispose();
        }
    }
}
