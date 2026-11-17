using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class SaleView : UserControl
{
    public SaleViewModel? Vm { get; private set; }

    public SaleView()
    {
        InitializeComponent();
        SizeChanged += (_, _) => Fit();
        CartGrid.SizeChanged += (_, _) => FitCartColumns();
    }

    const double DesignWidth = 1240, DesignHeight = 690, MinScale = 0.85, MaxScale = 1.6;

    void Fit()
    {
        if (ActualWidth <= 0 || ActualHeight <= 0) return;
        var scale = Math.Clamp(Math.Min(ActualWidth / DesignWidth, ActualHeight / DesignHeight), MinScale, MaxScale);
        UiScale.ScaleX = UiScale.ScaleY = Math.Round(scale, 2);
        var side = ActualWidth / scale < 1300 ? 270 : 300;
        EntryColumn.Width = LedgerColumn.Width = new GridLength(side);
    }

    void FitCartColumns()
    {
        if (CartGrid.View is not GridView view || view.Columns.Count < 7 || CartGrid.ActualWidth <= 0) return;
        double[] fixedWidths = [110, 0, 90, 70, 100, 0, 44];
        var room = CartGrid.ActualWidth - 30;
        var flexible = Math.Max(room - fixedWidths.Sum(), 0);
        view.Columns[0].Width = 110;
        view.Columns[2].Width = 90;
        view.Columns[3].Width = 70;
        view.Columns[4].Width = 100;
        view.Columns[6].Width = 44;
        view.Columns[1].Width = Math.Max(150, flexible * 0.55);
        view.Columns[5].Width = Math.Max(120, flexible * 0.45);
    }

    public void Attach(SaleViewModel vm)
    {
        Vm = vm;
        DataContext = vm;
        vm.FocusRequested += target => Dispatcher.BeginInvoke(() =>
        {
            switch (target)
            {
                case FocusTarget.Customer: FocusCustomer(); break;
                case FocusTarget.Unit: FocusAll(UnitBox); break;
                default: FocusAll(NumberBox); break;
            }
        });
        vm.CartScrollRequested += row => Dispatcher.BeginInvoke(() => CartGrid.ScrollIntoView(row));
        DataObject.AddPastingHandler(NumberBox, (_, e) => FilterPaste(e, NumberAllowed));
        DataObject.AddPastingHandler(UnitBox, (_, e) => FilterPaste(e, UnitAllowed));
        PreviewKeyDown += OnPreviewKeyDown;
    }

    void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (Vm is null) return;
        switch (e.Key)
        {
            case Key.F6: Vm.AutoMode = !Vm.AutoMode; e.Handled = true; break;
            case Key.F7 when Vm.CanExtraSave: Vm.ExtraSave = !Vm.ExtraSave; e.Handled = true; break;
            case Key.F8: Vm.PrintOnCheckout = !Vm.PrintOnCheckout; e.Handled = true; break;
            case Key.F4:
            case Key.F12:
                if (Vm.CheckoutCommand.CanExecute(null)) Vm.CheckoutCommand.Execute(null);
                e.Handled = true;
                break;
            case Key.F10:
                if (Vm.HoldCommand.CanExecute(null)) Vm.HoldCommand.Execute(null);
                e.Handled = true;
                break;
        }
    }

    void EntryBox_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e) => ((TextBox)sender).SelectAll();

    void EntryBox_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        var box = (TextBox)sender;
        if (box.IsKeyboardFocusWithin) return;
        box.Focus();
        e.Handled = true;
    }

    static void FocusAll(TextBox box) { box.Focus(); box.SelectAll(); }

    public void FocusCustomerOnShow() =>
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Input, FocusCustomer);

    void FocusCustomer()
    {
        CustomerBox.Focus();
        if (CustomerBox.Template.FindName("PART_EditableTextBox", CustomerBox) is TextBox tb) tb.SelectAll();
    }

    void CustomerBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        CustomerBox.IsDropDownOpen = false;
        FocusAll(NumberBox);
        e.Handled = true;
    }

    void OptionButton_Click(object sender, RoutedEventArgs e)
    {
        OptionMenu.PlacementTarget = OptionButton;
        OptionMenu.Placement = System.Windows.Controls.Primitives.PlacementMode.Top;
        OptionMenu.IsOpen = true;
    }

    void NumberBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && NumberBox.Text.Trim().Length > 0)
        {
            if (Vm?.UMode == true) Vm.AddCommand.Execute(null);
            else FocusAll(UnitBox);
            e.Handled = true;
        }
        else if (e.Key == Key.Escape) { NumberBox.Clear(); e.Handled = true; }
    }

    bool NumberAllowed(char c) => char.IsAsciiDigit(c) || (Vm?.RMode != true && "R*SMPWTKBN-".Contains(c));
    static bool UnitAllowed(char c) => char.IsAsciiDigit(c) || c == '+';

    static void FilterPaste(DataObjectPastingEventArgs e, Func<char, bool> allowed)
    {
        var text = e.DataObject.GetData(DataFormats.UnicodeText) as string ?? "";
        var mapped = text.Trim().ToUpperInvariant().Replace("/", "R");
        if (!allowed('+')) mapped = mapped.Replace("+", "P");
        if (mapped.Length == 0 || !mapped.All(allowed)) { e.CancelCommand(); return; }
        if (mapped == text) return;
        var data = new DataObject();
        data.SetData(DataFormats.UnicodeText, mapped);
        e.DataObject = data;
    }

    void NumberBox_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        var mapped = e.Text.ToUpperInvariant().Replace("/", "R").Replace("+", "P");
        if (mapped.Length == 0 || !mapped.All(NumberAllowed)) { e.Handled = true; return; }
        if (mapped == "R" && NumberBox.Text.Length == NumberBox.SelectionLength && Vm?.RestReverseOfLast() is { } rr)
        {
            e.Handled = true;
            NumberBox.Text = rr;
            NumberBox.CaretIndex = rr.Length;
            return;
        }
        if (mapped == e.Text.ToUpperInvariant()) return;
        e.Handled = true;
        NumberBox.SelectedText = mapped;
        NumberBox.CaretIndex = NumberBox.SelectionStart + NumberBox.SelectionLength;
    }

    void UnitBox_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (e.Text is "r" or "R" or "/" && Vm is not null) { Vm.AddRToNumber(); e.Handled = true; return; }
        if (!e.Text.All(UnitAllowed)) e.Handled = true;
    }

    void DiscountBox_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (!e.Text.All(ch => char.IsAsciiDigit(ch) || ch == '.')) e.Handled = true;
    }

    void UnitBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || Vm is null) return;
        Vm.AddCommand.Execute(null);
        e.Handled = true;
    }

    string _ledgerFind = "";
    long _ledgerFindAt;

    void LedgerList_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (Vm is null || e.Text.Length == 0 || !e.Text.All(char.IsAsciiDigit)) return;
        var now = Environment.TickCount64;
        if (now - _ledgerFindAt > 800) _ledgerFind = "";
        _ledgerFindAt = now;
        var digits = Math.Max(1, Vm.LedgerDigits);
        _ledgerFind = _ledgerFind.Length >= digits ? e.Text : _ledgerFind + e.Text;
        if (Vm.SelectLedgerByTyped(_ledgerFind))
        {
            if (SelectedLedger() is { } row) LedgerList.ScrollIntoView(row);
            e.Handled = true;
        }
    }

    LedgerRow? SelectedLedger() => Vm?.SelectedLedgerRow;

    void LedgerList_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Back && _ledgerFind.Length > 0 && Vm is not null)
        {
            _ledgerFind = _ledgerFind[..^1];
            _ledgerFindAt = Environment.TickCount64;
            if (_ledgerFind.Length > 0) Vm.SelectLedgerByTyped(_ledgerFind);
            e.Handled = true;
        }
        else if (e.Key == Key.Escape) _ledgerFind = "";
    }

    void CartGrid_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Delete || Keyboard.Modifiers != ModifierKeys.None) return;
        if (DeleteSelectedRows()) e.Handled = true;
    }

    bool DeleteSelectedRows()
    {
        if (Vm is null || CartGrid.SelectedItems.Count == 0) return false;
        var ids = CartGrid.SelectedItems.Cast<CartRow>().Where(r => !r.IsChild).Select(r => r.RowId).Distinct().ToList();
        if (ids.Count == 0) return false;
        Vm.RemoveRows(ids);
        return true;
    }

    bool _syncingCartSel;
    void CartGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingCartSel) return;
        _syncingCartSel = true;
        try
        {
            var ids = CartGrid.SelectedItems.Cast<CartRow>().Select(r => r.RowId).ToHashSet();
            foreach (var row in CartGrid.Items.Cast<CartRow>())
            {
                if (ids.Contains(row.RowId) && !CartGrid.SelectedItems.Contains(row))
                    CartGrid.SelectedItems.Add(row);
            }
        }
        finally { _syncingCartSel = false; }
    }

    void CartGrid_ContextMenuOpening(object sender, ContextMenuEventArgs e)
    {
        var item = ItemsControl.ContainerFromElement(CartGrid, (DependencyObject)e.OriginalSource) as ListViewItem;
        if (item?.DataContext is not CartRow row) { e.Handled = true; return; }
        if (!item.IsSelected) { CartGrid.SelectedItems.Clear(); item.IsSelected = true; }
        var parents = CartGrid.SelectedItems.Cast<CartRow>().Where(r => !r.IsChild).ToList();
        CartMenuUngroup.IsEnabled = parents.Count == 1 && parents[0].IsGroup;
        CartMenuDelete.IsEnabled = parents.Count > 0;
    }

    void CartMenuDelete_Click(object sender, RoutedEventArgs e) => DeleteSelectedRows();

    void CartMenuUngroup_Click(object sender, RoutedEventArgs e)
    {
        var parent = CartGrid.SelectedItems.Cast<CartRow>().FirstOrDefault(r => r.IsGroup && !r.IsChild);
        if (Vm is not null && parent is not null) Vm.UngroupCommand.Execute(parent.RowId);
    }

    void SendButton_MouseDown(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        SendMenu.PlacementTarget = SendButton;
        SendMenu.Placement = System.Windows.Controls.Primitives.PlacementMode.Top;
        SendMenu.IsOpen = true;
    }
}
