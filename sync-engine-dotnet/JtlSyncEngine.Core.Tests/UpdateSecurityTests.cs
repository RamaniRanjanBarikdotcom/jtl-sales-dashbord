using System.Security.Cryptography;
using System.Text;
using JtlSyncEngine.Models;
using JtlSyncEngine.Updates;
using Xunit;

namespace JtlSyncEngine.Core.Tests;

public sealed class UpdateSecurityTests
{
    private static ReleaseEnvelope SignedRelease(
        RSA rsa,
        string version = "1.5.0",
        string applicationId = "JtlSyncEngine")
    {
        var manifest = new ReleaseManifest
        {
            ApplicationId = applicationId,
            Channel = "stable",
            Version = version,
            GitSha = "abcdef1234567",
            ProtocolVersion = 2,
            MinimumSupportedVersion = "1.4.0",
            PackagePath = "/api/sync-agent/releases/00000000-0000-0000-0000-000000000001/package",
            PackageSize = 32,
            Sha256 = new string('a',64),
            PublisherCertificateThumbprints =
                new[] { "ABCDEF1234567890ABCDEF1234567890ABCDEF12" },
            PublishedAt = "2026-07-29T00:00:00.000Z",
            RequiresServiceRestart = true,
            HealthTimeoutSeconds = 120,
        };
        var signature = rsa.SignData(
            Encoding.UTF8.GetBytes(CanonicalJson.Serialize(manifest)),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        return new ReleaseEnvelope
        {
            Id = Guid.NewGuid().ToString(),
            Manifest = manifest,
            Signature = Convert.ToBase64String(signature),
        };
    }

    [Fact]
    public void ManifestVerifier_AcceptsValidManifest()
    {
        using var rsa = RSA.Create(2048);
        var release = SignedRelease(rsa);
        new ReleaseManifestVerifier().Verify(
            release,rsa.ExportSubjectPublicKeyInfoPem(),"1.4.0");
    }

    [Fact]
    public void CanonicalManifest_MatchesBackendContract()
    {
        using var rsa = RSA.Create(2048);
        var manifest = SignedRelease(rsa).Manifest;
        Assert.Equal(
            "{\"applicationId\":\"JtlSyncEngine\",\"channel\":\"stable\"," +
            "\"gitSha\":\"abcdef1234567\",\"healthTimeoutSeconds\":120," +
            "\"minimumSupportedVersion\":\"1.4.0\"," +
            "\"packagePath\":\"/api/sync-agent/releases/00000000-0000-0000-0000-000000000001/package\"," +
            "\"packageSize\":32,\"protocolVersion\":2," +
            "\"publishedAt\":\"2026-07-29T00:00:00.000Z\"," +
            "\"publisherCertificateThumbprints\":[\"ABCDEF1234567890ABCDEF1234567890ABCDEF12\"]," +
            "\"releaseNotes\":null,\"requiresMachineRestart\":false," +
            "\"requiresServiceRestart\":true,\"sha256\":\"" + new string('a',64) +
            "\",\"version\":\"1.5.0\"}",
            CanonicalJson.Serialize(manifest));
    }

    [Fact]
    public void ManifestVerifier_RejectsTamperingAndUnknownKey()
    {
        using var rsa = RSA.Create(2048);
        using var unknown = RSA.Create(2048);
        var release = SignedRelease(rsa);
        release.Manifest.Version = "1.5.1";
        Assert.ThrowsAny<CryptographicException>(() =>
            new ReleaseManifestVerifier().Verify(
                release,rsa.ExportSubjectPublicKeyInfoPem(),"1.4.0"));
        release = SignedRelease(rsa);
        Assert.ThrowsAny<CryptographicException>(() =>
            new ReleaseManifestVerifier().Verify(
                release,unknown.ExportSubjectPublicKeyInfoPem(),"1.4.0"));
    }

    [Theory]
    [InlineData("1.3.9","1.4.0")]
    [InlineData("1.4.0","1.4.0")]
    public void ManifestVerifier_RejectsDowngradeOrSameVersion(
        string target,string current)
    {
        using var rsa = RSA.Create(2048);
        Assert.Throws<InvalidDataException>(() =>
            new ReleaseManifestVerifier().Verify(
                SignedRelease(rsa,target),rsa.ExportSubjectPublicKeyInfoPem(),current));
    }

    [Fact]
    public void ManifestVerifier_RejectsWrongApplicationIdentity()
    {
        using var rsa = RSA.Create(2048);
        Assert.Throws<InvalidDataException>(() =>
            new ReleaseManifestVerifier().Verify(
                SignedRelease(rsa,applicationId: "OtherAgent"),
                rsa.ExportSubjectPublicKeyInfoPem(),"1.4.0"));
    }

    [Fact]
    public async Task PackageVerifier_RejectsWrongHash()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(path,"signed payload");
            await Assert.ThrowsAsync<CryptographicException>(() =>
                new ReleasePackageVerifier().VerifyHashAsync(
                    path,new string('0',64),CancellationToken.None));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void TrustedChild_RejectsPathTraversal()
    {
        var root = Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));
        Assert.Throws<InvalidDataException>(() =>
            UpdateStagingService.TrustedChild(root,Path.Combine("..","escape")));
    }

    [Theory]
    [InlineData("payload.ps1")]
    [InlineData("OtherTool.exe")]
    [InlineData("other-certificate.pem")]
    public void Staging_RejectsUnsupportedPayloadFiles(string relative)
    {
        Assert.Throws<InvalidDataException>(() =>
            UpdateStagingService.ValidatePayloadFile(relative));
    }

    [Theory]
    [InlineData("JtlSyncEngine.exe")]
    [InlineData("JtlSyncEngine.Service.exe")]
    [InlineData("JtlSyncEngine.Updater.exe")]
    [InlineData("JtlSyncEngine.Core.dll")]
    [InlineData("version.json")]
    [InlineData("manifest-public-key.pem")]
    [InlineData("README-PORTABLE.txt")]
    public void Staging_AllowsOnlyExpectedPayloadFileClasses(string relative)
    {
        UpdateStagingService.ValidatePayloadFile(relative);
    }

    [Fact]
    public void Downloader_RejectsHttpAndUnapprovedHosts()
    {
        Assert.Throws<InvalidOperationException>(() =>
            ReleasePackageDownloader.ResolveTrustedUri(
                "http://updates.example.com/api/",
                "/api/sync-agent/releases/release/package",
                Array.Empty<string>()));
        Assert.Throws<InvalidOperationException>(() =>
            ReleasePackageDownloader.ResolveTrustedUri(
                "https://api.example.com/api/",
                "https://evil.example.net/release.zip",
                new[] { "updates.example.com" }));
    }

    [Fact]
    public void Downloader_AcceptsBackendAndExplicitAllowlistedHosts()
    {
        Assert.Equal(
            "api.example.com",
            ReleasePackageDownloader.ResolveTrustedUri(
                "https://api.example.com/api/",
                "/api/sync-agent/releases/release/package",
                Array.Empty<string>()).Host);
        Assert.Equal(
            "updates.example.com",
            ReleasePackageDownloader.ResolveTrustedUri(
                "https://api.example.com/api/",
                "https://updates.example.com/release.zip",
                new[] { "updates.example.com" }).Host);
    }

    [Fact]
    public void MaintenanceWindow_SupportsOvernightRanges()
    {
        var settings = new UpdateSettings
        {
            MaintenanceWindowStart = "22:00",
            MaintenanceWindowEnd = "02:00",
            AllowedDays = new[] { "Sunday" },
        };
        var sunday = new DateTimeOffset(2026,8,2,23,0,0,TimeSpan.Zero);
        var monday = new DateTimeOffset(2026,8,3,1,0,0,TimeSpan.Zero);
        Assert.True(MaintenanceWindow.IsAllowedNow(settings,"maintenance",sunday));
        Assert.True(MaintenanceWindow.IsAllowedNow(settings,"maintenance",monday));
        Assert.False(MaintenanceWindow.IsAllowedNow(
            settings,"maintenance",monday.AddHours(2)));
        Assert.True(MaintenanceWindow.IsAllowedNow(
            settings,"now",monday.AddHours(2)));
    }
}
