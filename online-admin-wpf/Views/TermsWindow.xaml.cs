using System.Windows;
using System.Windows.Input;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class TermsWindow : Window
{
    readonly Session _session;
    readonly TermsWindowViewModel _vm;

    public TermsWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        _vm = new TermsWindowViewModel(session);
        DataContext = _vm;
        Loaded += async (_, _) => await _vm.LoadAsync();
    }

    public static void ShowList(Window? owner, Session session)
    {
        var w = new TermsWindow(session) { Owner = owner };
        w.ShowDialog();
    }

    async void New_Click(object sender, RoutedEventArgs e)
    {
        if (_session.Folder is null)
        {
            MessageBox.Show(this, "ဖိုင် အရင်ဖွင့်ပါ", "အပါတ်စဥ်");
            return;
        }
        if (!_session.Folder.CanManage)
        {
            MessageBox.Show(this, "ဤဖိုင်ကို ပြင်၍ မရပါ", "အပါတ်စဥ်");
            return;
        }
        var form = TermFormDialog.AskNew(this);
        if (form is null) return;
        await _vm.CreateAsync(form);
    }

    async void Edit_Click(object sender, RoutedEventArgs e) => await EditSelectedAsync();

    async void List_MouseDoubleClick(object sender, MouseButtonEventArgs e) => await EditSelectedAsync();

    async Task EditSelectedAsync()
    {
        if (_vm.Selected is not { } row)
        {
            MessageBox.Show(this, "အပါတ်စဥ် ရွေးပါ", "အပါတ်စဥ်");
            return;
        }
        if (!row.CanManage)
        {
            MessageBox.Show(this, "ဤအပါတ်စဥ်ကို ပြင်၍ မရပါ", "အပါတ်စဥ်");
            return;
        }
        var full = await _vm.LoadOneAsync(row.Id);
        if (full is null) return;
        var brk = (int)(full.Limits.FirstOrDefault()?.MaxUnits ?? 0);
        var form = TermFormDialog.AskEdit(this, full, brk);
        if (form is null) return;
        await _vm.UpdateAsync(row.Id, form);
    }

    async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_vm.Selected is not { } row)
        {
            MessageBox.Show(this, "အပါတ်စဥ် ရွေးပါ", "အပါတ်စဥ်");
            return;
        }
        if (!row.CanManage)
        {
            MessageBox.Show(this, "ဤအပါတ်စဥ်ကို ပြင်၍ မရပါ", "အပါတ်စဥ်");
            return;
        }
        if (MessageBox.Show(this, $"\"{row.Description}\" ကို ဖျက်မလား?", "Delete", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;
        await _vm.DeleteAsync(row.Id);
    }

    async void Activate_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.Button { Tag: TermListRow row }) return;
        await _vm.SetStatusAsync(row.Id, "open");
    }

    async void CloseTerm_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.Button { Tag: TermListRow row }) return;
        if (MessageBox.Show(this, $"\"{row.Description}\" ကို ပိတ်မလား?", "အပါတ်စဥ်", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        await _vm.SetStatusAsync(row.Id, "closed");
    }

    void Exit_Click(object sender, RoutedEventArgs e) => Close();
}
