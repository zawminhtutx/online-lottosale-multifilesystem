using System.Windows;
using System.Windows.Input;

namespace OnlineLotto.Wpf.Views;

public partial class LedgerEmailDialog : Window
{
    public string? Recipients { get; private set; }

    LedgerEmailDialog(string? recipients)
    {
        InitializeComponent();
        foreach (var email in (recipients ?? "").Split(new[] { ',', ';', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                     .Select(value => value.Trim()).Where(value => value.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
            EmailList.Items.Add(email);
        Loaded += (_, _) => EmailBox.Focus();
    }

    public static string? Ask(Window owner, string? recipients)
    {
        var dialog = new LedgerEmailDialog(recipients) { Owner = owner };
        return dialog.ShowDialog() == true ? dialog.Recipients : null;
    }

    void Save_Click(object sender, RoutedEventArgs e)
    {
        var values = EmailList.Items.Cast<string>().ToArray();
        if (values.Length > 30) { ErrorText.Text = "Email 30 ခုအထိသာ ထည့်နိုင်သည်"; return; }
        Recipients = string.Join("\n", values);
        DialogResult = true;
    }

    void Add_Click(object sender, RoutedEventArgs e) => AddEmail();

    void EmailBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        AddEmail();
        e.Handled = true;
    }

    void AddEmail()
    {
        var email = EmailBox.Text.Trim().ToLowerInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$"))
        { ErrorText.Text = "Email address ပုံစံမမှန်ပါ"; return; }
        if (EmailList.Items.Count >= 30) { ErrorText.Text = "Email 30 ခုအထိသာ ထည့်နိုင်သည်"; return; }
        if (EmailList.Items.Cast<string>().Any(value => string.Equals(value, email, StringComparison.OrdinalIgnoreCase)))
        { ErrorText.Text = "ဤ email ကို စာရင်းထဲထည့်ပြီးဖြစ်သည်"; return; }
        EmailList.Items.Add(email);
        EmailBox.Clear();
        ErrorText.Text = "";
        EmailBox.Focus();
    }

    void Remove_Click(object sender, RoutedEventArgs e)
    {
        if (EmailList.SelectedItem is not string email) { ErrorText.Text = "ဖျက်လိုသည့် email ကို ရွေးပါ"; return; }
        EmailList.Items.Remove(email);
        ErrorText.Text = "";
    }
}
