use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandRequest {
    pub id: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandResponse {
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl RemoteCommandResponse {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ok: false,
            result: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEventEnvelope {
    pub channel: String,
    pub payload: Value,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{RemoteCommandRequest, RemoteCommandResponse, RemoteEventEnvelope};

    #[test]
    fn remote_command_response_constructors_match_transport_shape() {
        let success = RemoteCommandResponse::success("req-1", json!({ "threads": [] }));
        assert!(success.ok);
        assert_eq!(success.result, Some(json!({ "threads": [] })));
        assert_eq!(success.error, None);

        let failure = RemoteCommandResponse::failure("req-2", "denied");
        assert!(!failure.ok);
        assert_eq!(failure.result, None);
        assert_eq!(failure.error.as_deref(), Some("denied"));
    }

    #[test]
    fn remote_protocol_envelopes_serialize_with_camel_case_fields() {
        let request = RemoteCommandRequest {
            id: "req-3".to_string(),
            command: "list_workspaces".to_string(),
            args: Some(json!({ "workspaceId": "ws-1" })),
        };
        let encoded_request = serde_json::to_value(&request).expect("failed to encode request");
        assert_eq!(encoded_request["workspaceId"], Value::Null);
        assert_eq!(encoded_request["args"]["workspaceId"], "ws-1");

        let event = RemoteEventEnvelope {
            channel: "stream-event-thread-1".to_string(),
            payload: json!({ "type": "turn.started" }),
        };
        let encoded_event = serde_json::to_value(&event).expect("failed to encode event");
        assert_eq!(encoded_event["channel"], "stream-event-thread-1");
        assert_eq!(encoded_event["payload"]["type"], "turn.started");
    }

    use serde_json::Value;
}
