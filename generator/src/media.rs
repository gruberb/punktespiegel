fn kicker_id<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let digits = value.strip_prefix(prefix)?;
    if digits.is_empty() || !digits.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    let trimmed = digits.trim_start_matches('0');
    Some(if trimmed.is_empty() { "0" } else { trimmed })
}

pub fn kicker_team_logo_url(team_id: &str) -> Option<String> {
    let id = kicker_id(team_id, "tm-k")?;
    Some(format!(
        "https://sportsfeed.kicker.de/MediaService/TeamLogo?teamId={id}&width=200"
    ))
}

pub fn kicker_player_photo_url(player_id: &str, team_id: &str) -> Option<String> {
    let player = kicker_id(player_id, "pl-k")?;
    let team = kicker_id(team_id, "tm-k")?;
    Some(format!(
        "https://sportsfeed.kicker.de/MediaService/PlayerLogo?playerId={player}&width=290&teamId={team}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_kicker_media_urls_from_import_ids() {
        assert_eq!(
            kicker_team_logo_url("tm-k00000118").as_deref(),
            Some("https://sportsfeed.kicker.de/MediaService/TeamLogo?teamId=118&width=200")
        );
        assert_eq!(
            kicker_player_photo_url("pl-k00144321", "tm-k00000118").as_deref(),
            Some(
                "https://sportsfeed.kicker.de/MediaService/PlayerLogo?playerId=144321&width=290&teamId=118"
            )
        );
    }
}
