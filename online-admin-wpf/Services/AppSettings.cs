using System.IO;
using System.Text.Json;

namespace OnlineLotto.Wpf.Services;

public sealed class AppSettings
{
    public string ServerUrl { get; set; } = "https://online-lottosale.onrender.com";
    public string Username { get; set; } = "";

    public string SlipPrinter { get; set; } = "";
    public string ReportPrinter { get; set; } = "";
    public string ReportPaper { get; set; } = "A4";
    public bool SoundsOn { get; set; } = true;

    public string SlipWidth { get; set; } = "80mm";
    public string SlipFontSize { get; set; } = "normal";
    public bool SlipBold { get; set; }
    public string SlipColumns { get; set; } = "two";
    public bool SlipShowTotal { get; set; } = true;
    public bool SlipShowAmount { get; set; } = true;
    public bool SlipGroupPrint { get; set; } = true;
    public double SlipMarginMm { get; set; } = 1.6;
    public double SlipItemsExtraMarginMm { get; set; } = 8;
    public string SlipLogoDataUrl { get; set; } = "";
    public double SlipLogoWidthMm { get; set; } = 20;
    public string SlipFooter { get; set; } = "";

    static string Path => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "OnlineLottoAdmin", "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(Path))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(Path)) ?? new();
        }
        catch { /* keep defaults */ }
        return new();
    }

    public void Save()
    {
        var dir = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
