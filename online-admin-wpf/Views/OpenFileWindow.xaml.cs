using System.Windows;
using System.Windows.Input;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class OpenFileWindow : Window
{
    readonly OpenFileViewModel _vm;
    bool _opening;

    public OpenFileWindow(Session session)
    {
        InitializeComponent();
        _vm = new OpenFileViewModel(session);
        DataContext = _vm;
        Loaded += async (_, _) => await _vm.LoadCommand.ExecuteAsync(null);
    }

    public static bool Ask(Window? owner, Session session)
    {
        var w = new OpenFileWindow(session);
        if (owner is not null) { w.Owner = owner; w.WindowStartupLocation = WindowStartupLocation.CenterOwner; }
        return w.ShowDialog() == true && session.Folder is not null;
    }

    async void Ok_Click(object sender, RoutedEventArgs e) => await AcceptAsync();

    void Cancel_Click(object sender, RoutedEventArgs e)
    {
        try { DialogResult = false; }
        catch (InvalidOperationException) { Close(); }
    }

    async void ItemList_MouseDoubleClick(object sender, MouseButtonEventArgs e) => await AcceptAsync();

    async Task AcceptAsync()
    {
        if (_opening) return;
        _opening = true;
        try
        {
            if (!await _vm.OpenAsync()) return;
            try { DialogResult = true; }
            catch (InvalidOperationException) { Close(); }
        }
        finally { _opening = false; }
    }
}
