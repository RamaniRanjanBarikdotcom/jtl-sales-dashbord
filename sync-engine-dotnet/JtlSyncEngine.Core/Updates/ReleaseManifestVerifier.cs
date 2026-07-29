using System.Security.Cryptography;
using System.Text;

namespace JtlSyncEngine.Updates
{
    public sealed class ReleaseManifestVerifier
    {
        public void Verify(ReleaseEnvelope envelope, string publicKeyPem, string currentVersion)
        {
            var manifest = envelope.Manifest;
            if (!string.Equals(manifest.ApplicationId, "JtlSyncEngine", StringComparison.Ordinal))
                throw new InvalidDataException("Update manifest application identity is invalid.");
            if (manifest.ProtocolVersion < 2)
                throw new InvalidDataException("Update manifest protocol is unsupported.");
            if (!Uri.TryCreate(manifest.PackagePath, UriKind.Relative, out _) ||
                !manifest.PackagePath.StartsWith("/api/sync-agent/releases/", StringComparison.Ordinal))
                throw new InvalidDataException("Update package path is not a trusted backend-relative path.");
            if (!IsSha256(manifest.Sha256))
                throw new InvalidDataException("Update package SHA-256 is invalid.");
            if (manifest.PackageSize <= 0)
                throw new InvalidDataException("Update package size is invalid.");
            if (CompareVersions(manifest.Version, currentVersion) <= 0)
                throw new InvalidDataException("Update downgrade or reinstall is not allowed.");
            if (!string.IsNullOrWhiteSpace(manifest.MinimumSupportedVersion) &&
                CompareVersions(currentVersion, manifest.MinimumSupportedVersion) < 0)
                throw new InvalidDataException("A bridge upgrade is required for this release.");
            if (manifest.PublisherCertificateThumbprints.Length == 0)
                throw new InvalidDataException("No approved publisher certificate is declared.");
            if (string.IsNullOrWhiteSpace(publicKeyPem))
                throw new InvalidOperationException("Manifest public key is not configured.");

            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKeyPem);
            var data = Encoding.UTF8.GetBytes(CanonicalJson.Serialize(manifest));
            var signature = Convert.FromBase64String(envelope.Signature);
            if (!rsa.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                throw new CryptographicException("Update manifest signature is invalid.");
        }

        public static int CompareVersions(string left, string right)
        {
            static int[] Parse(string value) => value.Split('-')[0].Split('.')
                .Take(3).Select(part => int.TryParse(part, out var number) ? number : 0)
                .Concat(new[] { 0, 0, 0 }).Take(3).ToArray();
            var a = Parse(left); var b = Parse(right);
            for (var index = 0; index < 3; index++)
                if (a[index] != b[index]) return a[index].CompareTo(b[index]);
            return 0;
        }

        private static bool IsSha256(string value) =>
            value.Length == 64 && value.All(Uri.IsHexDigit);
    }
}
