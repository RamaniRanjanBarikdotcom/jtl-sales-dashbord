using System;
using System.Threading;

namespace JtlSyncEngine.Runtime
{
    public sealed class SchedulerOwnership : IDisposable
    {
        public const string GlobalMutexName = @"Global\JtlSyncEngine-Scheduler";

        private readonly Mutex _mutex;
        private bool _ownsMutex;

        public SchedulerOwnership(string mutexName = GlobalMutexName)
        {
            _mutex = new Mutex(false, mutexName);
        }

        public bool TryAcquire()
        {
            if (_ownsMutex) return true;
            try
            {
                _ownsMutex = _mutex.WaitOne(0);
            }
            catch (AbandonedMutexException)
            {
                _ownsMutex = true;
            }
            return _ownsMutex;
        }

        public void Release()
        {
            if (!_ownsMutex) return;
            _mutex.ReleaseMutex();
            _ownsMutex = false;
        }

        public void Dispose()
        {
            Release();
            _mutex.Dispose();
        }
    }
}
