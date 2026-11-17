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
