using System;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using JtlSyncEngine.ViewModels;

namespace JtlSyncEngine.Views
{
    // Converter for IsEnabled when Windows Auth is checked
    public class NotBooleanConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is bool b ? !b : false;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => value is bool b ? !b : false;
    }

    public class NotEmptyToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is string s && !string.IsNullOrEmpty(s) ? Visibility.Visible : Visibility.Collapsed;
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    public partial class SettingsView : UserControl
    {
        public static readonly NotBooleanConverter NotBoolConverter = new();
        public static readonly NotEmptyToVisibilityConverter NotEmptyToVisConverter = new();

        public SettingsView()
        {
            InitializeComponent();
            DataContextChanged += OnDataContextChanged;
        }

        private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (e.NewValue is SettingsViewModel vm)
            {
                // Load password box values (can't bind PasswordBox directly for security)
                sqlPasswordBox.Password = vm.SqlPassword;
                apiKeyBox.Password = vm.ApiKey;

                sqlPasswordBox.PasswordChanged += (s, _) => vm.SqlPassword = sqlPasswordBox.Password;
                apiKeyBox.PasswordChanged += (s, _) => vm.ApiKey = apiKeyBox.Password;
            }
        }
    }
}
