using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace OnlineLotto.Wpf;

public sealed class NullToCollapsedConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) =>
        value is null || (value is string s && string.IsNullOrWhiteSpace(s)) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => throw new NotSupportedException();
}

public sealed class EqualsToConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) =>
        string.Equals(value?.ToString(), p?.ToString(), StringComparison.Ordinal);

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) =>
        value is true ? p : Binding.DoNothing;
}

public sealed class InverseBoolToVisConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) =>
        value is true ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => throw new NotSupportedException();
}
