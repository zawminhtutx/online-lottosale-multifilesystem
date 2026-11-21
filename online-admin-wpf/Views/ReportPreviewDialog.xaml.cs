using System.Windows;

namespace OnlineLotto.Wpf.Views;

public partial class ReportPreviewDialog : Window
{
    readonly string _text;

    ReportPreviewDialog(string mode, string title, string text)
    {
        InitializeComponent();
        Title = $"{mode} — {title}";
        HeadingText.Text = $"{mode} · {title}";
        PreviewText.Text = text;
        _text = text;
    }

    public static void Show(Window owner, string mode, string title, string text) =>
        new ReportPreviewDialog(mode, title, text) { Owner = owner }.ShowDialog();

    void Copy_Click(object sender, RoutedEventArgs e)
    {
        try { Clipboard.SetText(_text); }
        catch (System.Runtime.InteropServices.COMException) { MessageBox.Show(this, "Clipboard ကို ထပ်နှိပ်ပါ", Title); }
    }

    void Exit_Click(object sender, RoutedEventArgs e) => Close();
}
