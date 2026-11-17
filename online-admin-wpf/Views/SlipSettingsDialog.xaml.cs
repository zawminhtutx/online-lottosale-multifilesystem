using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public partial class SlipSettingsDialog : Window
{
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    readonly Session _session;
    readonly AppSettings _local;
    string _logo = "";

    public SlipSettingsDialog(Session session, AppSettings settings)
    {
        InitializeComponent();
        _session = session;
        _local = settings;
        CompanyBox.IsEnabled = session.IsAdmin;
        (string.Equals(_local.SlipWidth, "58mm", StringComparison.OrdinalIgnoreCase) ? Width58 : Width80).IsChecked = true;
        ( _local.SlipFontSize switch { "small" => FontSmall, "large" => FontLarge, _ => FontNormal }).IsChecked = true;
        MarginBox.Text = _local.SlipMarginMm.ToString("0.##", Inv);
        ItemMarginBox.Text = _local.SlipItemsExtraMarginMm.ToString("0.##", Inv);
        (string.Equals(_local.SlipColumns, "single", StringComparison.OrdinalIgnoreCase) ? SingleColumn : TwoColumn).IsChecked = true;
        BoldBox.IsChecked = _local.SlipBold;
        GroupBox.IsChecked = _local.SlipGroupPrint;
        AmountBox.IsChecked = _local.SlipShowAmount;
        TotalBox.IsChecked = _local.SlipShowTotal;
        LogoWidthBox.Text = _local.SlipLogoWidthMm.ToString("0.##", Inv);
        FooterBox.Text = _local.SlipFooter;
        _logo = _local.SlipLogoDataUrl;
        ShowLogo();
        Loaded += async (_, _) => await LoadCompanyAsync();
    }

    public static void Show(Window owner, Session session, AppSettings settings) =>
        new SlipSettingsDialog(session, settings) { Owner = owner }.ShowDialog();

    async Task LoadCompanyAsync()
    {
        try
        {
            var c = await _session.Api.GetAsync<CompanySettingsDto>("api/settings/company");
            CompanyBox.Text = c.CompanyName;
        }
        catch (ApiException ex) { Fail(ex.Message); }
    }

    void Fail(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
    }

    void ShowLogo()
    {
        LogoImage.Source = null;
        if (_logo.Length > 0 && _logo.IndexOf(',') is var comma and > 0)
        {
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.StreamSource = new MemoryStream(Convert.FromBase64String(_logo[(comma + 1)..]));
                bmp.EndInit();
                LogoImage.Source = bmp;
            }
            catch { /* bad logo data */ }
        }
        NoLogoText.Visibility = LogoImage.Source is null ? Visibility.Visible : Visibility.Collapsed;
        RemoveLogoButton.IsEnabled = _logo.Length > 0;
    }

    void BrowseLogo_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog { Title = "Logo ပုံ ရွေးပါ", Filter = "Images|*.png;*.jpg;*.jpeg;*.bmp;*.gif" };
        if (dialog.ShowDialog(this) != true) return;
        var info = new FileInfo(dialog.FileName);
        if (info.Length > 512 * 1024) { Fail("Logo ပုံ 512 KB ထက် မကြီးရပါ"); return; }
        var mime = info.Extension.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".bmp" => "image/bmp",
            ".gif" => "image/gif",
            _ => "image/png",
        };
        _logo = $"data:{mime};base64,{Convert.ToBase64String(File.ReadAllBytes(info.FullName))}";
        ShowLogo();
    }

    void RemoveLogo_Click(object sender, RoutedEventArgs e)
    {
        _logo = "";
        ShowLogo();
    }

    static bool TryMm(string text, out double value) =>
        double.TryParse(text.Trim(), NumberStyles.Float, Inv, out value) && value >= 0;

    async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!TryMm(MarginBox.Text, out var margin)) { Fail("Left Align Margin ကို ဂဏန်း ထည့်ပါ"); return; }
        if (!TryMm(ItemMarginBox.Text, out var itemMargin)) { Fail("Digit Item Extra Margin ကို ဂဏန်း ထည့်ပါ"); return; }
        if (!TryMm(LogoWidthBox.Text, out var logoWidth) || logoWidth < 5) logoWidth = 20;
        _local.SlipWidth = Width58.IsChecked == true ? "58mm" : "80mm";
        _local.SlipFontSize = FontSmall.IsChecked == true ? "small" : FontLarge.IsChecked == true ? "large" : "normal";
        _local.SlipMarginMm = margin;
        _local.SlipItemsExtraMarginMm = itemMargin;
        _local.SlipColumns = SingleColumn.IsChecked == true ? "single" : "two";
        _local.SlipBold = BoldBox.IsChecked == true;
        _local.SlipGroupPrint = GroupBox.IsChecked == true;
        _local.SlipShowAmount = AmountBox.IsChecked == true;
        _local.SlipShowTotal = TotalBox.IsChecked == true;
        _local.SlipLogoDataUrl = _logo;
        _local.SlipLogoWidthMm = logoWidth;
        _local.SlipFooter = FooterBox.Text.Trim();
        try { _local.Save(); }
        catch (Exception ex) { Fail(ex.Message); return; }

        if (_session.IsAdmin)
        {
            try
            {
                await _session.Api.PutAsync<CompanySettingsDto>("api/settings/company",
                    new { company_name = CompanyBox.Text.Trim() });
            }
            catch (ApiException ex) { Fail(ex.Message); return; }
        }
        DialogResult = true;
    }
}
