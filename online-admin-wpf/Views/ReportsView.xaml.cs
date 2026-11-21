using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class ReportsView : UserControl
{
    ReportsViewModel? _vm;

    public ReportsView() => InitializeComponent();

    public void Attach(ReportsViewModel vm)
    {
        if (_vm is not null)
        {
            _vm.BoardChanged -= PaintBoard;
            _vm.PropertyChanged -= OnVmChanged;
        }
        _vm = vm;
        DataContext = vm;
        vm.BoardChanged += PaintBoard;
        vm.PropertyChanged += OnVmChanged;
        PaintBoard();
    }

    void OnVmChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ReportsViewModel.ShowSummary) && _vm is { ShowSummary: false })
            PaintBoard();
    }

    void DotView_Click(object sender, RoutedEventArgs e) => ShowPreview("Dot View", dot: true);

    void ReportView_Click(object sender, RoutedEventArgs e)
    {
        if (_vm is null) return;
        if (string.IsNullOrWhiteSpace(_vm.PrintText()))
        {
            _vm.Message = "Report ကို View လုပ်ပြီးမှ ကြည့်လို့ရပါသည်";
            return;
        }
        var owner = Window.GetWindow(this);
        if (owner is not null) PageViewDialog.Show(owner, _vm.Title, _vm);
    }

    void ShowPreview(string mode, bool dot = false)
    {
        if (_vm is null) return;
        var text = dot ? _vm.DotText() : _vm.PrintText();
        if (string.IsNullOrWhiteSpace(text))
        {
            _vm.Message = "Report ကို View လုပ်ပြီးမှ ကြည့်လို့ရပါသည်";
            return;
        }
        var owner = Window.GetWindow(this);
        if (owner is not null) ReportPreviewDialog.Show(owner, mode, _vm.Title, text);
    }

    void PaintBoard()
    {
        if (_vm is null || BoardList is null) return;
        if (_vm.ShowSummary || _vm.BoardColumns.Count == 0)
        {
            BoardList.View = null;
            BoardList.ItemsSource = null;
            return;
        }
        var view = new GridView();
        for (var i = 0; i < _vm.BoardColumns.Count; i++)
        {
            var col = _vm.BoardColumns[i];
            var text = new FrameworkElementFactory(typeof(TextBlock));
            text.SetBinding(TextBlock.TextProperty, new Binding($"Cells[{i}]"));
            if (col.Right) text.SetValue(TextBlock.TextAlignmentProperty, TextAlignment.Right);
            text.SetValue(TextBlock.PaddingProperty, new Thickness(4, 1, 6, 1));
            var header = new GridViewColumnHeader { Content = col.Header };
            if (col.Right) header.HorizontalContentAlignment = HorizontalAlignment.Right;
            view.Columns.Add(new GridViewColumn
            {
                Header = header,
                Width = col.Width,
                CellTemplate = new DataTemplate { VisualTree = text },
            });
        }
        BoardList.View = view;
        BoardList.ItemsSource = _vm.BoardRows;
    }
}
