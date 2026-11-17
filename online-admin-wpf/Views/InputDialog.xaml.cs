using System.Windows;

namespace OnlineLotto.Wpf.Views;

public partial class InputDialog : Window
{
    public InputDialog() => InitializeComponent();

    public static string? Ask(Window? owner, string title, string label, string? seed = null)
    {
        var w = new InputDialog { Owner = owner, Title = title };
        w.HeadingText.Text = title;
        w.LabelText.Text = label;
        w.ValueBox.Text = seed ?? "";
        w.ValueBox.SelectAll();
        w.Loaded += (_, _) => w.ValueBox.Focus();
        return w.ShowDialog() == true ? w.ValueBox.Text.Trim() : null;
    }

    void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(ValueBox.Text)) return;
        DialogResult = true;
    }
}
