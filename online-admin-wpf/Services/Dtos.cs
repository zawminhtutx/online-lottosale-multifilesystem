namespace OnlineLotto.Wpf.Services;

public sealed class LoginResponse
{
    public string Token { get; set; } = "";
    public UserDto User { get; set; } = new();
}

public sealed class UserDto
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string? Name { get; set; }
    public string Role { get; set; } = "";
    public decimal Balance { get; set; }
    public int Unlimited { get; set; }
    public int SaleOver { get; set; }
    public string Status { get; set; } = "active";
    public string? Phone { get; set; }
}

public sealed class BetTypeDto
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Description { get; set; } = "";
    public int Digits { get; set; }
    public int IsActive { get; set; }
}

public sealed class MetaDto
{
    public List<BetTypeDto> BetTypes { get; set; } = [];
}

public sealed class FolderDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int TermCount { get; set; }
    public int AutoTerms { get; set; }
    public bool CanManage { get; set; }
    public string? CreatedAt { get; set; }
}

public sealed class TermDto
{
    public int Id { get; set; }
    public string Description { get; set; } = "";
    public string Game { get; set; } = "";
    public string Status { get; set; } = "";
    public decimal UnitPrice { get; set; }
    public string? OpenAt { get; set; }
    public string? CloseAt { get; set; }
    public string? DrawAt { get; set; }
    public int? FolderId { get; set; }
    public string? FolderName { get; set; }
    public bool CanManage { get; set; }
    public List<TermLimitDto> Limits { get; set; } = [];
    public List<TermResultDto> Results { get; set; } = [];
}

public sealed class TermResultDto
{
    public int Slot { get; set; }
    public string Value { get; set; } = "";
    public string? Label { get; set; }
}

public sealed class TermLimitDto
{
    public int BetTypeId { get; set; }
    public decimal MaxUnits { get; set; }
}

public sealed class TicketEntry
{
    public int BetTypeId { get; set; }
    public string Input { get; set; } = "";
    public List<string> Numbers { get; set; } = [];
    public int Units { get; set; }
}

public sealed class PlaceTicketRequest
{
    public int TermId { get; set; }
    public int UserId { get; set; }
    public bool SaveOver { get; set; }
    public List<TicketEntry> Entries { get; set; } = [];
}

public sealed class SlipNoDto
{
    public string SlipNo { get; set; } = "";
}

public sealed class ExposureDto
{
    public int BetTypeId { get; set; }
    public string Number { get; set; } = "";
    public decimal Units { get; set; }
}

public sealed class OverviewDto
{
    public List<RoleStatDto> Accounts { get; set; } = [];
    public List<StatusCountDto> Terms { get; set; } = [];
    public TodayDto Today { get; set; } = new();
}

public sealed class RoleStatDto
{
    public string Role { get; set; } = "";
    public int Count { get; set; }
    public int Active { get; set; }
    public decimal Balance { get; set; }
}

public sealed class StatusCountDto
{
    public string Status { get; set; } = "";
    public int Count { get; set; }
}

public sealed class TodayDto
{
    public int Tickets { get; set; }
    public decimal Sales { get; set; }
}

public sealed class SlipCancelDto
{
    public int Id { get; set; }
    public string CreatedAt { get; set; } = "";
    public string Username { get; set; } = "";
    public string SlipNo { get; set; } = "";
    public string TermDescription { get; set; } = "";
    public decimal NetAmount { get; set; }
}

public sealed class ErrorBody
{
    public string? Error { get; set; }
}

public sealed class CommissionUserDto
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string? Name { get; set; }
    public string Role { get; set; } = "";
    public string Status { get; set; } = "";
    public Dictionary<string, decimal> Discounts { get; set; } = [];
}

public sealed class CommissionSaveRow
{
    public int UserId { get; set; }
    public int BetTypeId { get; set; }
    public decimal Discount { get; set; }
}

public sealed class TermTemplateDto
{
    public string Name { get; set; } = "";
    public string Game { get; set; } = "2D";
    public int UnitPrice { get; set; } = 1;
    public int UnitBreak { get; set; } = 1;
    public string Open { get; set; } = "09:30";
    public string Close { get; set; } = "11:59";
    public string Draw { get; set; } = "12:02";
}

public sealed class CompanySettingsDto
{
    public string CompanyName { get; set; } = "";
}

public sealed class PrizeRateDto
{
    public int BetTypeId { get; set; }
    public decimal Multiplier { get; set; }
    public decimal Discount { get; set; }
}

public sealed class PrizeSetDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int TwodMultiplier { get; set; }
    public int UserCount { get; set; }
    public bool CanManage { get; set; }
    public List<PrizeRateDto> Rates { get; set; } = [];
}

public sealed class SummaryRowDto
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string? Name { get; set; }
    public int Tickets { get; set; }
    public decimal Gross { get; set; }
    public decimal Discount { get; set; }
    public decimal Net { get; set; }
    public decimal Payout { get; set; }
    public decimal Profit { get; set; }
}

public sealed class PurchaseItem
{
    public int BetTypeId { get; set; }
    public string Number { get; set; } = "";
    public int Units { get; set; }
}

public sealed class PurchaseRequest
{
    public List<PurchaseItem> Items { get; set; } = [];
}
