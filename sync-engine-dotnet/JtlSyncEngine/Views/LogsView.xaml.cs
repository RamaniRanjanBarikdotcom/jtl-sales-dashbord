using System;
using System.Collections.Specialized;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using JtlSyncEngine.ViewModels;

namespace JtlSyncEngine.Views
{
    public class NullToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value != null ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    public partial class LogsView : UserControl
    {
        public static readonly NullToVisibilityConverter NullToVisConverter = new();

        public LogsView()
        {
            InitializeComponent();
            DataContextChanged += OnDataContextChanged;
        }

        private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (e.NewValue is LogsViewModel vm)
            {
                // Auto-scroll when new log entries are added
                vm.AllEntries.CollectionChanged += (s, args) =>
                {
                    if (args.Action == NotifyCollectionChangedAction.Add)
                    {
                        Dispatcher.InvokeAsync(() =>
                        {
                            if (logListView.Items.Count > 0)
                            {
                                logListView.ScrollIntoView(logListView.Items[^1]);
                            }
                        });
                    }
                };
            }
        }
    }
}
