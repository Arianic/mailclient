use serde::Serialize;

#[derive(Clone, Copy)]
pub enum AccountKind {
    PersonalGmail,
    PersonalOutlook,
    WorkImap,
}
pub enum Purpose {
    AutomaticRelevance,
    ExplicitSummary,
    ExplicitReply,
}
pub struct MessageContext<'a> {
    pub account: AccountKind,
    pub sender: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
    pub contains_work_material: bool,
}
#[derive(Debug, PartialEq, Serialize)]
pub struct CloudContext {
    sender: String,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

// No cloud client is enabled yet. Future cloud dispatch must obtain its payload
// through this backend boundary after resolving account identity from storage.
// Caller-supplied account labels or email instructions are not authorization.
pub fn prepare_context(
    message: MessageContext<'_>,
    purpose: Purpose,
    user_requested_body: bool,
) -> Result<CloudContext, &'static str> {
    if matches!(message.account, AccountKind::WorkImap) || message.contains_work_material {
        return Err("Work email and derived work content cannot be sent to cloud AI");
    }
    let body = match purpose {
        Purpose::AutomaticRelevance => None,
        Purpose::ExplicitSummary | Purpose::ExplicitReply if user_requested_body => {
            Some(message.body.to_owned())
        }
        _ => return Err("This action requires an explicit request to share the message body"),
    };
    Ok(CloudContext {
        sender: message.sender.to_owned(),
        subject: message.subject.to_owned(),
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn message(account: AccountKind) -> MessageContext<'static> {
        MessageContext {
            account,
            sender: "sender@example.com",
            subject: "Hello",
            body: "private body",
            contains_work_material: false,
        }
    }
    #[test]
    fn automatic_relevance_never_serializes_a_body_even_with_body_permission() {
        for account in [AccountKind::PersonalGmail, AccountKind::PersonalOutlook] {
            let context =
                prepare_context(message(account), Purpose::AutomaticRelevance, true).unwrap();
            let json = serde_json::to_string(&context).unwrap();
            assert!(!json.contains("body"));
            assert!(!json.contains("private body"));
        }
    }
    #[test]
    fn work_mail_is_denied_for_automatic_and_explicit_actions() {
        for purpose in [
            Purpose::AutomaticRelevance,
            Purpose::ExplicitSummary,
            Purpose::ExplicitReply,
        ] {
            assert!(prepare_context(message(AccountKind::WorkImap), purpose, true).is_err());
        }
    }
    #[test]
    fn personal_bodies_need_a_deliberate_request() {
        assert!(prepare_context(
            message(AccountKind::PersonalGmail),
            Purpose::ExplicitSummary,
            false
        )
        .is_err());
        assert!(prepare_context(
            message(AccountKind::PersonalOutlook),
            Purpose::ExplicitReply,
            true
        )
        .unwrap()
        .body
        .is_some());
    }
    #[test]
    fn derived_work_material_remains_excluded_in_personal_mail() {
        let mut context = message(AccountKind::PersonalGmail);
        context.contains_work_material = true;
        assert!(prepare_context(context, Purpose::ExplicitSummary, true).is_err());
    }
}
