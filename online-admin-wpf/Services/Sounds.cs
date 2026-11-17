using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;

namespace OnlineLotto.Wpf.Services;

public enum Sound { Click, Hover, DigitEntry, BreakLimit, CheckOut, Recycle, Info }

public static class Sounds
{
    static readonly Dictionary<Sound, string> Files = new()
    {
        [Sound.Click] = "click.wav",
        [Sound.Hover] = "ho.wav",
        [Sound.DigitEntry] = "digit_entry.wav",
        [Sound.BreakLimit] = "brak_limit.wav",
        [Sound.CheckOut] = "check_out.wav",
        [Sound.Recycle] = "recycle.wav",
        [Sound.Info] = "info.wav",
    };
    static readonly Dictionary<Sound, MediaPlayer> Players = new();
    static bool _enabled;

    public static bool On { get; set; } = true;

    public static void Enable()
    {
        if (_enabled) return;
        _enabled = true;
        EventManager.RegisterClassHandler(typeof(ButtonBase), UIElement.MouseEnterEvent, new MouseEventHandler((_, _) => Play(Sound.Hover)));
        EventManager.RegisterClassHandler(typeof(TabItem), UIElement.MouseEnterEvent, new MouseEventHandler((_, _) => Play(Sound.Hover)));
        EventManager.RegisterClassHandler(typeof(ButtonBase), ButtonBase.ClickEvent, new RoutedEventHandler((_, _) => Play(Sound.Click)));
    }

    public static void Play(Sound sound)
    {
        if (!_enabled || !On) return;
        try
        {
            if (!Players.TryGetValue(sound, out var player))
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Sounds", Files[sound]);
                if (!File.Exists(path)) return;
                player = new MediaPlayer();
                player.Open(new Uri(path));
                Players[sound] = player;
            }
            player.Stop();
            player.Position = TimeSpan.Zero;
            player.Play();
        }
        catch (Exception) { /* sale keeps working without speakers */ }
    }
}
