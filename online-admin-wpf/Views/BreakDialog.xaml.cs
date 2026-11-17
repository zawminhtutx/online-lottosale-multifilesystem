using System.Collections.ObjectModel;
using System.Windows;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed class BreakField
{
    public int BetTypeId { get; init; }
    public string Label { get; init; } = "";
    public string Units { get; set; } = "0";
}

public partial class BreakDialog : Window
{
    readonly ObservableCollection<BreakField> _fields = [];
    List<TermLimitDto>? _result;

    public BreakDialog() => InitializeComponent();

    public static List<TermLimitDto>? Ask(Window? owner, TermDto term, IReadOnlyList<BetTypeDto> types)
    {
        var w = new BreakDialog();
        w.Owner = owner;
        w.TermText.Text = term.Description;
        var current = term.Limits.ToDictionary(l => l.BetTypeId, l => l.MaxUnits);
        foreach (var bt in types)
        {
            w._fields.Add(new BreakField
            {
                BetTypeId = bt.Id,
                Label = $"{bt.Description} — ယူနစ်",
                Units = current.TryGetValue(bt.Id, out var u) ? ((int)u).ToString() : "0",
            });
        }
        w.FieldList.ItemsSource = w._fields;
        return w.ShowDialog() == true ? w._result : null;
    }

    void Save_Click(object sender, RoutedEventArgs e)
    {
        var rows = new List<TermLimitDto>();
        foreach (var field in _fields)
        {
            if (!int.TryParse(field.Units.Trim(), out var n) || n < 0)
            {
                ErrorText.Text = "ယူနစ် 0 နှင့်အထက် ထည့်ပါ";
                ErrorBox.Visibility = Visibility.Visible;
                return;
            }
            if (n > 0) rows.Add(new TermLimitDto { BetTypeId = field.BetTypeId, MaxUnits = n });
        }
        _result = rows;
        DialogResult = true;
    }
}
