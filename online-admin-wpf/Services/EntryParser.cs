using System.Text.RegularExpressions;

namespace OnlineLotto.Wpf.Services;

public readonly record struct ParseResult(IReadOnlyList<string> Numbers, string? Error)
{
    public static ParseResult Fail(string error) => new([], error);
    public static ParseResult Ok(IReadOnlyList<string> numbers) => new(numbers, null);
}

public static class EntryParser
{
    static readonly Dictionary<string, string> Labels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["W"] = "ပါဝါ", ["SP"] = "စုံပူး", ["MP"] = "မပူး", ["SM"] = "စုံမ",
        ["MM"] = "မမ", ["MS"] = "မစုံ", ["SS"] = "စုံစုံ", ["P"] = "အပူး",
        ["K"] = "နက္ခက်", ["N"] = "ညီကို", ["T"] = "ထွိုင်",
    };

    public static string Normalize(string value) =>
        value.ToUpperInvariant().Replace('+', 'P').Replace('/', 'R');

    public static string Hint(string entry, int digits)
    {
        var word = digits == 3 ? "သုံးလုံး" : "နှစ်လုံး";
        var raw = Normalize(entry).Trim();
        if (raw.Length == 0) return word;
        if (Regex.IsMatch(raw, @"^\d+R{1,2}$")) return $"{word}ပတ်လည်";
        var mid = Regex.Match(raw, @"^(\d+)\*(\d+)$");
        if (mid.Success) return $"{mid.Groups[1].Value}{mid.Groups[2].Value}အလယ်စီးရီး";
        if (Regex.IsMatch(raw, @"^(\d+)\*$")) return $"{raw.TrimEnd('*')}နောက်စီးရီး";
        if (Regex.IsMatch(raw, @"^\*(\d+)$")) return $"{raw.TrimStart('*')}ရှေ့စီးရီး";
        if (digits == 2 && Regex.IsMatch(raw, @"^\d{3,}-?$"))
        {
            var d = raw.TrimEnd('-');
            if (d.Distinct().Count() != d.Length) return "ထပ်ဂဏန်း မရပါ";
            return raw.EndsWith('-') ? "အပြီးခွေ (အပူးမပါ)" : "အပြီးခွေ";
        }
        if (Labels.TryGetValue(raw, out var named)) return named;
        var m = Regex.Match(raw, @"^(\d+)P$"); if (m.Success) return $"{m.Groups[1].Value}အပါ";
        m = Regex.Match(raw, @"^(\d+)S$"); if (m.Success) return $"{m.Groups[1].Value}စုံ";
        m = Regex.Match(raw, @"^(\d+)M$"); if (m.Success) return $"{m.Groups[1].Value}မ";
        m = Regex.Match(raw, @"^(\d+)B$"); if (m.Success) return $"{m.Groups[1].Value} ဘရိတ်";
        if (Regex.IsMatch(raw, @"^\d{3,}A$")) return raw[..^1];
        return word;
    }

    public static ParseResult Parse(string raw, int digits, bool rMode)
    {
        raw = Normalize(raw).Trim();
        if (raw.Length == 0) return ParseResult.Fail("ဂဏန်း ထည့်ပါ");
        if (rMode && Regex.IsMatch(raw, @"^\d+$")) raw += "R";

        var apaye = Regex.Match(raw, @"^(\d{3,})(A|-)$");
        if (apaye.Success)
        {
            if (digits != 2) return ParseResult.Fail("အပြီးပေါက် ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်");
            return ExpandApaye(apaye.Groups[1].Value, apaye.Groups[2].Value != "-");
        }

        if (raw is "SM" or "MM" or "MS" or "SS" or "SP" or "MP" or "P" or "N" or "W" or "K" or "T")
            return Named(raw, digits);

        var star = Regex.Match(raw, @"^(\d+)\*$");
        if (star.Success)
        {
            var p = star.Groups[1].Value;
            if (p.Length != digits - 1) return ParseResult.Fail($"ဂဏန်း {digits - 1} လုံး + * ဖြစ်ရမည်");
            return ParseResult.Ok(Enumerable.Range(0, 10).Select(d => p + d).ToList());
        }
        var starF = Regex.Match(raw, @"^\*(\d+)$");
        if (starF.Success)
        {
            var s = starF.Groups[1].Value;
            if (s.Length != digits - 1) return ParseResult.Fail($"ဂဏန်း {digits - 1} လုံး + * ဖြစ်ရမည်");
            return ParseResult.Ok(Enumerable.Range(0, 10).Select(d => $"{d}{s}").ToList());
        }
        var starM = Regex.Match(raw, @"^(\d+)\*(\d+)$");
        if (starM.Success)
        {
            var front = starM.Groups[1].Value;
            var back = starM.Groups[2].Value;
            if (front.Length + back.Length != digits - 1) return ParseResult.Fail($"ဂဏန်း {digits - 1} လုံး + * ဖြစ်ရမည်");
            return ParseResult.Ok(Enumerable.Range(0, 10).Select(d => $"{front}{d}{back}").ToList());
        }

        var br = Regex.Match(raw, @"^(\d)B$");
        if (br.Success)
        {
            if (digits != 2) return ParseResult.Fail($"{raw} ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်");
            var k = int.Parse(br.Groups[1].Value);
            return ParseResult.Ok(Enumerable.Range(0, 10).Select(a => $"{a}{(10 + k - a) % 10}").ToList());
        }

        var pwr = Regex.Match(raw, @"^(\d)P$");
        if (pwr.Success)
        {
            if (digits != 2) return ParseResult.Fail("ဂဏန်းP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်");
            var d = pwr.Groups[1].Value;
            var set = new HashSet<string>();
            for (var i = 0; i <= 9; i++) { set.Add($"{d}{i}"); set.Add($"{i}{d}"); }
            return ParseResult.Ok(set.ToList());
        }
        var evenP = Regex.Match(raw, @"^(\d)S$");
        if (evenP.Success)
        {
            if (digits != 2) return ParseResult.Fail("ဂဏန်းS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်");
            var d = evenP.Groups[1].Value;
            var numbers = new List<string>();
            foreach (var e in new[] { 0, 2, 4, 6, 8 }) { numbers.Add($"{d}{e}"); numbers.Add($"{e}{d}"); }
            return ParseResult.Ok(numbers);
        }
        var oddP = Regex.Match(raw, @"^(\d)M$");
        if (oddP.Success)
        {
            if (digits != 2) return ParseResult.Fail("ဂဏန်းM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်");
            var d = oddP.Groups[1].Value;
            var numbers = new List<string>();
            foreach (var o in new[] { 1, 3, 5, 7, 9 }) { numbers.Add($"{d}{o}"); numbers.Add($"{o}{d}"); }
            return ParseResult.Ok(numbers);
        }

        if (raw.EndsWith("RR", StringComparison.Ordinal) && raw.Length > 2 && raw[..^2].All(char.IsDigit))
        {
            var b = raw[..^2];
            if (b.Length != digits) return ParseResult.Fail($"ဂဏန်း {digits} လုံး ဖြစ်ရမည်");
            var nums = Perms(b).Where(n => n != b).ToList();
            return nums.Count == 0 ? ParseResult.Fail($"{b} ကျန်ဂဏန်း မရှိပါ") : ParseResult.Ok(nums);
        }
        if (raw.EndsWith('R') && raw.Length > 1 && raw[..^1].All(char.IsDigit))
        {
            var b = raw[..^1];
            if (b.Length != digits) return ParseResult.Fail($"ဂဏန်း {digits} လုံး ဖြစ်ရမည်");
            return ParseResult.Ok(Perms(b));
        }
        if (raw.Contains('R')) return ParseResult.Fail("R ပုံစံ မှားနေပါတယ် (ဥပမာ - 45R)");

        if (raw.All(char.IsDigit))
        {
            if (digits == 2 && raw.Length >= 3) return ExpandApaye(raw, true);
            if (raw.Length != digits) return ParseResult.Fail($"ဂဏန်း {digits} လုံး ဖြစ်ရမည်");
            return ParseResult.Ok([raw]);
        }

        return ParseResult.Fail($"\"{raw}\" ပုံစံ မမှန်ကန်ပါ");
    }

    static ParseResult Named(string raw, int digits)
    {
        if (raw == "T")
        {
            if (digits != 3) return ParseResult.Fail("T ပုံစံသည် 3D အတွက်သာ ဖြစ်ပါသည်");
            return ParseResult.Ok(Enumerable.Range(0, 10).Select(d => $"{d}{d}{d}").ToList());
        }
        if (digits != 2) return ParseResult.Fail($"{raw} ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်");
        var even = new[] { 0, 2, 4, 6, 8 };
        var odd = new[] { 1, 3, 5, 7, 9 };
        return raw switch
        {
            "SM" => ParseResult.Ok(even.SelectMany(f => odd.Select(b => $"{f}{b}")).ToList()),
            "MS" => ParseResult.Ok(odd.SelectMany(f => even.Select(b => $"{f}{b}")).ToList()),
            "SS" => ParseResult.Ok(even.SelectMany(f => even.Select(b => $"{f}{b}")).ToList()),
            "MM" => ParseResult.Ok(odd.SelectMany(f => odd.Select(b => $"{f}{b}")).ToList()),
            "SP" => ParseResult.Ok(even.Select(d => $"{d}{d}").ToList()),
            "MP" => ParseResult.Ok(odd.Select(d => $"{d}{d}").ToList()),
            "P" => ParseResult.Ok(Enumerable.Range(0, 10).Select(d => $"{d}{d}").ToList()),
            "W" => ParseResult.Ok(Enumerable.Range(0, 5).SelectMany(d => new[] { $"{d}{d + 5}", $"{d + 5}{d}" }).ToList()),
            "K" => ParseResult.Ok(["07", "70", "18", "81", "24", "42", "35", "53", "69", "96"]),
            "N" => ParseResult.Ok(N()),
            _ => ParseResult.Fail($"\"{raw}\" ပုံစံ မမှန်ကန်ပါ"),
        };
    }

    static List<string> N()
    {
        var n = new List<string>();
        for (var b = 0; b <= 9; b++) n.Add($"{(b + 1) % 10}{b}");
        for (var f = 0; f <= 9; f++) n.Add($"{f}{(f + 1) % 10}");
        return n;
    }

    static ParseResult ExpandApaye(string digits, bool withDoubles)
    {
        if (digits.Distinct().Count() != digits.Length) return ParseResult.Fail("ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ");
        var codes = new List<string>();
        void Comb(int start, List<int> chosen)
        {
            if (chosen.Count == 2)
            {
                codes.Add($"{digits[chosen[0]]}{digits[chosen[1]]}R");
                return;
            }
            for (var i = start; i < digits.Length; i++) Comb(i + 1, [.. chosen, i]);
        }
        Comb(0, []);
        if (withDoubles)
            foreach (var c in digits.Distinct()) codes.Add($"{c}{c}");
        var seen = new HashSet<string>();
        var numbers = new List<string>();
        foreach (var code in codes.Distinct())
        {
            var parts = code.EndsWith('R') ? Perms(code[..^1]) : [code];
            foreach (var n in parts) if (seen.Add(n)) numbers.Add(n);
        }
        return numbers.Count == 0 ? ParseResult.Fail("အပြီးခွေ ဂဏန်း မရပါ") : ParseResult.Ok(numbers);
    }

    static List<string> Perms(string str)
    {
        var results = new HashSet<string>();
        void Go(string remaining, string prefix)
        {
            if (remaining.Length == 0) { results.Add(prefix); return; }
            for (var i = 0; i < remaining.Length; i++)
                Go(remaining.Remove(i, 1), prefix + remaining[i]);
        }
        Go(str, "");
        return [.. results];
    }
}
