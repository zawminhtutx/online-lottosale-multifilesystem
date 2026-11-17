using System.Collections.ObjectModel;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public partial class SettingsWindow : Window
{
    readonly Session _session;
    readonly AppSettings _local;
    readonly ObservableCollection<TermTemplateDto> _templates = [];

    public SettingsWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        _local = AppSettings.Load();
        AutoTermsSection.Visibility = session.IsBook ? Visibility.Visible : Visibility.Collapsed;
        var printers = InstalledPrinters();
        SlipPrinterBox.ItemsSource = printers;
        ReportPrinterBox.ItemsSource = printers;
        SlipPrinterBox.Text = _local.SlipPrinter;
        ReportPrinterBox.Text = _local.ReportPrinter;
        (string.Equals(_local.ReportPaper, "Letter", StringComparison.OrdinalIgnoreCase) ? PaperLetter : PaperA4).IsChecked = true;
        SoundsBox.IsChecked = _local.SoundsOn;
        TemplateList.ItemsSource = _templates;
        Loaded += async (_, _) => await LoadTemplatesAsync();
    }

    public static void Show(Window owner, Session session) =>
        new SettingsWindow(session) { Owner = owner }.ShowDialog();

    static List<string> InstalledPrinters()
    {
        try
        {
            using var server = new LocalPrintServer();
            return server.GetPrintQueues([EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections])
                .Select(q => q.FullName).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
        }
        catch { return []; }
    }

    async Task LoadTemplatesAsync()
    {
        if (!_session.IsBook) return;
        try
        {
            var list = await _session.Api.GetAsync<List<TermTemplateDto>>("api/term-folders/templates");
            _templates.Clear();
            foreach (var t in list) _templates.Add(t);
        }
        catch (ApiException ex) { Say(ex.Message, true); }
    }

    void AddTemplate_Click(object sender, RoutedEventArgs e)
    {
        var open = TplOpen.Text.Trim();
        var close = TplClose.Text.Trim();
        var draw = TplDraw.Text.Trim();
        if (open.Length == 0 || close.Length == 0 || draw.Length == 0) { Say("ဖွင့် / ပိတ် / ထွက်ချိန် ထည့်ပါ", true); return; }
        if (string.CompareOrdinal(open, close) >= 0 || string.CompareOrdinal(close, draw) > 0)
        {
            Say("ဖွင့်ချိန် < ပိတ်ချိန် ≤ ထွက်ချိန် ဖြစ်ရမည်", true);
            return;
        }
        if (!int.TryParse(TplPrice.Text.Trim(), out var price) || price <= 0) price = 1;
        if (!int.TryParse(TplBreak.Text.Trim(), out var brk) || brk < 0) brk = 1;
        var game = (TplGame.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "2D";
        _templates.Add(new TermTemplateDto
        {
            Name = TplName.Text.Trim(),
            Game = game,
            UnitPrice = price,
            UnitBreak = brk,
            Open = open,
            Close = close,
            Draw = draw,
        });
        TplName.Text = "";
    }

    void RemoveTemplate_Click(object sender, RoutedEventArgs e)
    {
        if (TemplateList.SelectedItem is TermTemplateDto row) _templates.Remove(row);
    }

    void SlipSettings_Click(object sender, RoutedEventArgs e) => SlipSettingsDialog.Show(this, _session, _local);

    async void Save_Click(object sender, RoutedEventArgs e)
    {
        _local.SlipPrinter = SlipPrinterBox.Text.Trim();
        _local.ReportPrinter = ReportPrinterBox.Text.Trim();
        _local.ReportPaper = PaperLetter.IsChecked == true ? "Letter" : "A4";
        _local.SoundsOn = SoundsBox.IsChecked == true;
        Sounds.On = _local.SoundsOn;
        try { _local.Save(); }
        catch (Exception ex) { Say(ex.Message, true); return; }

        if (_session.IsBook)
        {
            try { await _session.Api.PutAsync<List<TermTemplateDto>>("api/term-folders/templates", _templates.ToList()); }
            catch (ApiException ex) { Say(ex.Message, true); return; }
        }
        Say("Saved");
    }

    void Say(string text, bool error = false)
    {
        MessageText.Text = text;
        MessageText.Foreground = (System.Windows.Media.Brush)FindResource(error ? "Bad" : "Ok");
    }
}
