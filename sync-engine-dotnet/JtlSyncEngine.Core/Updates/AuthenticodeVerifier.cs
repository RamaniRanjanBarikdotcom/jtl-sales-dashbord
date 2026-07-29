using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;

namespace JtlSyncEngine.Updates
{
    public sealed class AuthenticodeVerifier
    {
        private const uint WtdUiNone = 2;
        private const uint WtdRevokeWholeChain = 1;
        private const uint WtdChoiceFile = 1;
        private const uint WtdStateActionIgnore = 0;
        private const uint WtdCacheOnlyUrlRetrieval = 0x00000004;
        private static readonly Guid GenericVerifyV2 =
            new("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");

        public void Verify(string filePath, IEnumerable<string> approvedThumbprints)
        {
            if (!OperatingSystem.IsWindows())
                throw new PlatformNotSupportedException("Authenticode verification requires Windows.");
            VerifyMachine(filePath);
            using var fileInfo = new WinTrustFileInfo(filePath);
            var data = new WinTrustData(fileInfo);
            uint result;
            try
            {
                result = WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, ref data);
            }
            finally
            {
                data.Dispose();
            }
            if (result != 0)
                throw new InvalidDataException($"Authenticode trust verification failed for {Path.GetFileName(filePath)} (0x{result:X8}).");

            using var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(filePath));
            var actual = Normalize(certificate.Thumbprint);
            var approved = approvedThumbprints.Select(Normalize).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (!approved.Contains(actual))
                throw new InvalidDataException($"Publisher certificate is not approved for {Path.GetFileName(filePath)}.");
            if (DateTime.UtcNow < certificate.NotBefore.ToUniversalTime() ||
                DateTime.UtcNow > certificate.NotAfter.ToUniversalTime())
                throw new InvalidDataException($"Publisher certificate is outside its validity period for {Path.GetFileName(filePath)}.");
        }

        private static void VerifyMachine(string filePath)
        {
            using var stream = File.OpenRead(filePath);
            using var reader = new BinaryReader(stream);
            if (reader.ReadUInt16() != 0x5A4D) throw new InvalidDataException("File is not a PE image.");
            stream.Position = 0x3c;
            var peOffset = reader.ReadInt32();
            stream.Position = peOffset;
            if (reader.ReadUInt32() != 0x00004550) throw new InvalidDataException("PE signature is invalid.");
            if (reader.ReadUInt16() != 0x8664) throw new InvalidDataException("Update binary is not x64.");
        }

        private static string Normalize(string? value) =>
            new((value ?? "").Where(Uri.IsHexDigit).Select(char.ToUpperInvariant).ToArray());

        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern uint WinVerifyTrust(
            IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid actionId, ref WinTrustData data);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private sealed class WinTrustFileInfo : IDisposable
        {
            private readonly IntPtr filePathPointer;
            public uint StructSize = (uint)Marshal.SizeOf<WinTrustFileInfo>();
            public IntPtr FilePath;
            public IntPtr FileHandle = IntPtr.Zero;
            public IntPtr KnownSubject = IntPtr.Zero;

            public WinTrustFileInfo(string filePath)
            {
                filePathPointer = Marshal.StringToCoTaskMemUni(filePath);
                FilePath = filePathPointer;
            }

            public void Dispose() => Marshal.FreeCoTaskMem(filePathPointer);
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WinTrustData : IDisposable
        {
            public uint StructSize;
            public IntPtr PolicyCallbackData;
            public IntPtr SipClientData;
            public uint UiChoice;
            public uint RevocationChecks;
            public uint UnionChoice;
            public IntPtr FileInfoPointer;
            public uint StateAction;
            public IntPtr StateData;
            public IntPtr UrlReference;
            public uint ProviderFlags;
            public uint UiContext;

            public WinTrustData(WinTrustFileInfo fileInfo)
            {
                StructSize = (uint)Marshal.SizeOf<WinTrustData>();
                PolicyCallbackData = IntPtr.Zero;
                SipClientData = IntPtr.Zero;
                UiChoice = WtdUiNone;
                RevocationChecks = WtdRevokeWholeChain;
                UnionChoice = WtdChoiceFile;
                FileInfoPointer = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustFileInfo>());
                Marshal.StructureToPtr(fileInfo, FileInfoPointer, false);
                StateAction = WtdStateActionIgnore;
                StateData = IntPtr.Zero;
                UrlReference = IntPtr.Zero;
                ProviderFlags = WtdCacheOnlyUrlRetrieval;
                UiContext = 0;
            }

            public void Dispose()
            {
                if (FileInfoPointer == IntPtr.Zero) return;
                Marshal.FreeCoTaskMem(FileInfoPointer);
                FileInfoPointer = IntPtr.Zero;
            }
        }
    }
}
