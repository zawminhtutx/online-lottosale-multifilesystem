using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class PageViewDialog : Window
{
    readonly ReportsViewModel _report;

    PageViewDialog(string title, ReportsViewModel report)
    {
        InitializeComponent();
        _report = report;
        Title = $"Page View — {title}";
        WindowHeading.Text = $"လယ်ဂျာ — {title} · A4";
        BuildPage();
    }

    public static void Show(Window owner, string title, ReportsViewModel report) =>
        new PageViewDialog(title, report) { Owner = owner }.ShowDialog();

    void BuildPage()
    {
        PageContent.Children.Clear();
        var term = _report.SelectedTerm?.Description ?? "New";
        var header = new Grid { Margin = new Thickness(0, 4, 0, 16) };
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.Children.Add(new TextBlock { Text = term, FontSize = 17, FontWeight = FontWeights.Bold });
        var date = new TextBlock
        {
            Text = DateTime.Now.ToString("dd/MM/yyyy, hh:mm:ss tt", CultureInfo.GetCultureInfo("en-US")),
            FontSize = 10, Foreground = Brushes.DimGray, HorizontalAlignment = HorizontalAlignment.Right
        };
        Grid.SetColumn(date, 1); header.Children.Add(date); PageContent.Children.Add(header);

        if (_report.ShowLedger && _report.BoardRows.Count > 0 && _report.BoardRows[0].Cells.Count == 20)
            BuildTwoDigitLedger();
        else
            PageContent.Children.Add(new TextBlock
            {
                Text = _report.PrintText(), FontFamily = new FontFamily("Consolas"), FontSize = 12,
                TextWrapping = TextWrapping.Wrap, Foreground = Brushes.Black
            });
    }

    void BuildTwoDigitLedger()
    {
        var grid = new UniformGrid
        {
            Columns = 20,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            SnapsToDevicePixels = true,
            UseLayoutRounding = true
        };
        foreach (var row in _report.BoardRows.Where(r => !r.IsTotal))
            for (var index = 0; index < row.Cells.Count; index++)
                grid.Children.Add(Cell(row.Cells[index], index % 2 == 0));
        PageContent.Children.Add(grid);

        var total = _report.BoardRows.LastOrDefault(r => r.IsTotal)?.Cells.LastOrDefault() ?? "0";
        PageContent.Children.Add(new TextBlock
        {
            Text = $"Total : {total}", FontSize = 11, FontWeight = FontWeights.Bold,
            Margin = new Thickness(0, 16, 0, 0)
        });
    }

    static Border Cell(string value, bool number) => new()
    {
        BorderBrush = new SolidColorBrush(Color.FromRgb(120, 120, 120)), BorderThickness = new Thickness(1),
        SnapsToDevicePixels = true, UseLayoutRounding = true, Height = 22, Child = new TextBlock
        {
            Text = value, FontSize = 10, VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = number ? HorizontalAlignment.Center : HorizontalAlignment.Right,
            Margin = new Thickness(3, 0, 4, 0), Foreground = number ? Brushes.Blue : Brushes.Black
        }
    };

    void ZoomBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // The selected item is applied while XAML is still constructing the window;
        // at that point the page transform has not necessarily been named yet.
        if (PageZoom is null) return;
        if (ZoomBox.SelectedItem is ComboBoxItem { Tag: string value }
            && double.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var zoom))
            PageZoom.ScaleX = PageZoom.ScaleY = zoom;
    }

    void Print_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new PrintDialog();
        if (dialog.ShowDialog() == true) dialog.PrintVisual(Paper, Title);
    }

    void Send_Click(object sender, RoutedEventArgs e)
    {
        try { Clipboard.SetText(_report.PrintText()); MessageBox.Show(this, "Report ကို clipboard သို့ ကူးပြီးပါပြီ", Title); }
        catch (System.Runtime.InteropServices.COMException) { MessageBox.Show(this, "Clipboard ကို ထပ်နှိပ်ပါ", Title); }
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
