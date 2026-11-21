using System.Windows;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public partial class PrizeAssignDialog : Window
{
    public PrizeSetDto? Result { get; private set; }
    public PrizeAssignDialog() => InitializeComponent();

    public static PrizeSetDto? Ask(Window owner, UserDto user, IReadOnlyList<PrizeSetDto> sets)
    {
        var w = new PrizeAssignDialog { Owner = owner };
        w.HeadingText.Text = $"{user.Username} · အလျော်အဆတွဲ";
        foreach (var set in sets) w.SetBox.Items.Add(set);
        w.SetBox.SelectedItem = sets.FirstOrDefault(x => x.Id == user.PrizeSetId) ?? sets.FirstOrDefault();
        return w.ShowDialog() == true ? w.Result : null;
    }

    void Save_Click(object sender, RoutedEventArgs e)
    {
        if (SetBox.SelectedItem is not PrizeSetDto set) return;
        Result = set;
        DialogResult = true;
    }
}
