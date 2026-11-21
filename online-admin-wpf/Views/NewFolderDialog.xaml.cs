using System.Windows;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed record NewFolderRequest(string Name, bool AutoTerms, DateTime? From, DateTime? To);

public partial class NewFolderDialog : Window
{
    const int MaxDays = 62;
    readonly IReadOnlyList<TermTemplateDto> _templates;

    public NewFolderRequest? Result { get; private set; }

    public NewFolderDialog(IReadOnlyList<TermTemplateDto> templates)
    {
        _templates = templates;
        InitializeComponent();
        var today = DateTime.Today;
        FromDate.SelectedDate = today;
        ToDate.SelectedDate = today;
        if (templates.Count == 0)
        {
            AutoPanel.Visibility = Visibility.Collapsed;
            return;
        }
        var names = string.Join(", ", templates.Select(t => string.IsNullOrWhiteSpace(t.Name) ? t.Game : t.Name));
        TemplateHint.Text = names;
        UpdateAutoLabel();
        FromDate.SelectedDateChanged += (_, _) => UpdateAutoLabel();
        ToDate.SelectedDateChanged += (_, _) => UpdateAutoLabel();
        Loaded += (_, _) => NameBox.Focus();
    }

    public static NewFolderRequest? Ask(Window? owner, IReadOnlyList<TermTemplateDto> templates)
    {
        var w = new NewFolderDialog(templates);
        if (owner is not null) w.Owner = owner;
        return w.ShowDialog() == true ? w.Result : null;
    }

    void Auto_Changed(object sender, RoutedEventArgs e) => UpdateAutoLabel();

    void UpdateAutoLabel()
    {
        if (AutoLabel is null || AutoBox is null) return;
        var perDay = _templates.Count;
        var days = DayCount();
        var n = AutoBox.IsChecked == true && days > 0 ? days * perDay : 0;
        AutoLabel.Text = n > 0
            ? $"Auto အပါတ်စဥ် ဆောက်မည် — ရက်တိုင်း {perDay} ခု  (စုစုပေါင်း {n} ခု)"
            : $"Auto အပါတ်စဥ် ဆောက်မည် — ရက်တိုင်း {perDay} ခု";
    }

    int DayCount()
    {
        if (FromDate is null || ToDate is null) return 0;
        if (FromDate.SelectedDate is not { } from || ToDate.SelectedDate is not { } to) return 0;
        from = from.Date;
        to = to.Date;
        if (to < from) return 0;
        return (int)(to - from).TotalDays + 1;
    }

    void Fail(string message)
    {
        ErrorText.Text = message;
        ErrorBox.Visibility = Visibility.Visible;
    }

    void Ok_Click(object sender, RoutedEventArgs e)
    {
        var name = NameBox.Text.Trim();
        if (name.Length == 0) { Fail("ဖိုင်အမည် ထည့်ပါ"); return; }
        var auto = AutoPanel.Visibility == Visibility.Visible && AutoBox.IsChecked == true;
        DateTime? from = null, to = null;
        if (auto)
        {
            if (FromDate.SelectedDate is not { } f || ToDate.SelectedDate is not { } t)
            {
                Fail("ရက်စွဲ (မှ – ထိ) ရွေးပါ");
                return;
            }
            from = f.Date;
            to = t.Date;
            if (to.Value < from.Value) { Fail("ထိ ရက်စွဲသည် မှ ရက်စွဲထက် မစောရပါ"); return; }
            var days = (int)(to.Value - from.Value).TotalDays + 1;
            if (days > MaxDays) { Fail($"တစ်ခါတည်း {MaxDays} ရက်ထက် ပိုမရွေးရပါ"); return; }
        }
        Result = new NewFolderRequest(name, auto, from, to);
        DialogResult = true;
    }
}
