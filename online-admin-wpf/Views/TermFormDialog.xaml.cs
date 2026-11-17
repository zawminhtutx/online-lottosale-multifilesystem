using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed class TermFormResult
{
    public string Description { get; init; } = "";
    public string Game { get; init; } = "";
    public int UnitPrice { get; init; }
    public int UnitBreak { get; init; }
    public string? OpenAt { get; init; }
    public string? CloseAt { get; init; }
    public string? DrawAt { get; init; }
}

public partial class TermFormDialog : Window
{
    TermFormResult? _result;

    public TermFormDialog() => InitializeComponent();

    public static TermFormResult? AskNew(Window? owner)
    {
        var now = DateTime.Now;
        var am = now.TimeOfDay < new TimeSpan(12, 2, 0);
        var name = $"{now:dd-MM-yyyy} {(am ? "AM" : "PM")}";
        return Ask(owner, "အပါတ်စဥ် အသစ်", name, "2D", "100", "0",
            now.Date.Add(am ? new TimeSpan(9, 30, 0) : new TimeSpan(12, 30, 0)),
            now.Date.Add(am ? new TimeSpan(11, 59, 0) : new TimeSpan(16, 0, 0)),
            now.Date.Add(am ? new TimeSpan(12, 2, 0) : new TimeSpan(16, 30, 0)));
    }

    public static TermFormResult? AskEdit(Window? owner, TermDto term, int unitBreak) =>
        Ask(owner, "အပါတ်စဥ် ပြင်ရန် / Settings", term.Description, term.Game,
            ((int)term.UnitPrice).ToString(CultureInfo.InvariantCulture),
            unitBreak.ToString(CultureInfo.InvariantCulture),
            ParseIso(term.OpenAt), ParseIso(term.CloseAt), ParseIso(term.DrawAt));

    static TermFormResult? Ask(Window? owner, string heading, string name, string game, string price, string brk,
        DateTime? open, DateTime? close, DateTime? draw)
    {
        var w = new TermFormDialog { Owner = owner, Title = heading };
        w.HeadingText.Text = heading;
        w.NameBox.Text = name;
        w.PriceBox.Text = price;
        w.BreakBox.Text = brk;
        Fill(w.OpenDate, w.OpenTimeBox, open);
        Fill(w.CloseDate, w.CloseTimeBox, close);
        Fill(w.DrawDate, w.DrawTimeBox, draw);
        foreach (ComboBoxItem item in w.GameBox.Items)
            item.IsSelected = string.Equals(item.Content?.ToString(), game, StringComparison.OrdinalIgnoreCase);
        w.Loaded += (_, _) => { w.NameBox.Focus(); w.NameBox.SelectAll(); };
        return w.ShowDialog() == true ? w._result : null;
    }

    static void Fill(DatePicker date, TextBox time, DateTime? value)
    {
        if (value is null) { date.SelectedDate = null; time.Text = ""; return; }
        date.SelectedDate = value.Value.Date;
        time.Text = value.Value.ToString("HH:mm");
    }

    static DateTime? ParseIso(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        return DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto)
            ? dto.LocalDateTime
            : null;
    }

    string? Combine(DatePicker date, TextBox time)
    {
        var hasDate = date.SelectedDate is not null;
        var text = time.Text.Trim();
        if (!hasDate && text.Length == 0) return null;
        var day = date.SelectedDate ?? DateTime.Today;
        var clock = TimeSpan.Zero;
        if (text.Length > 0)
        {
            if (!TimeSpan.TryParseExact(text, @"hh\:mm", CultureInfo.InvariantCulture, out clock)
                && !TimeSpan.TryParse(text, CultureInfo.InvariantCulture, out clock))
                throw new FormatException($"{time.Name} နာရီ:မိနစ် (09:30) ထည့်ပါ");
        }
        var local = DateTime.SpecifyKind(day.Date + clock, DateTimeKind.Local);
        return new DateTimeOffset(local).ToString("yyyy-MM-dd'T'HH:mm:sszzz");
    }

    void Save_Click(object sender, RoutedEventArgs e)
    {
        var name = NameBox.Text.Trim();
        if (name.Length == 0) { Fail("အပါတ်စဥ်အမည် ထည့်ပါ", NameBox); return; }
        var game = (GameBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "2D";
        if (!int.TryParse(PriceBox.Text.Trim().Replace(",", ""), NumberStyles.Integer, CultureInfo.InvariantCulture, out var price) || price <= 0)
        {
            Fail("Unit Price ကို 0 ထက်ကြီးတဲ့ ကိန်းဂဏန်း ထည့်ပါ", PriceBox);
            return;
        }
        if (!int.TryParse(BreakBox.Text.Trim().Replace(",", ""), NumberStyles.Integer, CultureInfo.InvariantCulture, out var brk) || brk < 0)
        {
            Fail("Break ကို 0 နှင့်အထက် ထည့်ပါ", BreakBox);
            return;
        }
        string? open, close, draw;
        try
        {
            open = Combine(OpenDate, OpenTimeBox);
            close = Combine(CloseDate, CloseTimeBox);
            draw = Combine(DrawDate, DrawTimeBox);
        }
        catch (FormatException ex)
        {
            ErrorText.Text = ex.Message;
            ErrorBox.Visibility = Visibility.Visible;
            return;
        }
        _result = new TermFormResult
        {
            Description = name,
            Game = game,
            UnitPrice = price,
            UnitBreak = brk,
            OpenAt = open,
            CloseAt = close,
            DrawAt = draw,
        };
        DialogResult = true;
    }

    void Fail(string message, TextBox box)
    {
        ErrorText.Text = message;
        ErrorBox.Visibility = Visibility.Visible;
        box.Focus();
        box.SelectAll();
    }
}
