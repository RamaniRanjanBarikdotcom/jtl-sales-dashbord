using System;
using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Controls;

namespace JtlSyncEngine.Views
{
    /// <summary>
    /// Converts a hex color string like "#34d399" to a SolidColorBrush for XAML bindings.
    /// </summary>
    public class StringToBrushConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is string hex && !string.IsNullOrWhiteSpace(hex))
            {
                try
                {
                    var color = (Color)ColorConverter.ConvertFromString(hex);
                    return new SolidColorBrush(color);
                }
                catch { }
            }
            return new SolidColorBrush(Colors.Gray);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    public partial class DashboardView : UserControl
    {
        public DashboardView()
        {
            InitializeComponent();
        }
    }
}
