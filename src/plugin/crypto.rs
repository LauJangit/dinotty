#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use super::helpers::plugin_err;
use super::manager::PluginManagerState;
use super::types::{CryptoHashRequest, CryptoHashResponse, CryptoHmacRequest, CryptoHmacResponse};

/// Computes a message digest over base64-encoded input bytes.
///
/// Plugins running in non-secure HTTP contexts (e.g. `http://192.168.x.x`)
/// cannot use `crypto.subtle`, so the framework offers this server-side
/// replacement. Supported algorithms: `sha1`, `sha256`, `sha384`, `sha512`, `md5`.
#[allow(clippy::unused_async)]
pub async fn plugin_crypto_hash(
    Path(_id): Path<String>,
    State(_pm): State<PluginManagerState>,
    Json(body): Json<CryptoHashRequest>,
) -> Response {
    use base64::Engine;
    use sha1::Digest;
    let data = match base64::engine::general_purpose::STANDARD.decode(&body.data) {
        Ok(b) => b,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid base64 data: {e}")),
    };
    let bytes: Vec<u8> = match body.algorithm.to_ascii_lowercase().as_str() {
        "sha1" => sha1::Sha1::digest(&data).to_vec(),
        "sha256" => sha2::Sha256::digest(&data).to_vec(),
        "sha384" => sha2::Sha384::digest(&data).to_vec(),
        "sha512" => sha2::Sha512::digest(&data).to_vec(),
        "md5" => md5::Md5::digest(&data).to_vec(),
        other => {
            return plugin_err(
                StatusCode::BAD_REQUEST,
                &format!("unsupported hash algorithm: {other}"),
            )
        }
    };
    Json(CryptoHashResponse { bytes: base64::engine::general_purpose::STANDARD.encode(bytes) })
        .into_response()
}

/// Computes an HMAC tag over base64-encoded input bytes using a base64-encoded key.
///
/// Supported algorithms: `sha1`, `sha256`, `sha384`, `sha512`, `md5`.
#[allow(clippy::unused_async)]
pub async fn plugin_crypto_hmac(
    Path(_id): Path<String>,
    State(_pm): State<PluginManagerState>,
    Json(body): Json<CryptoHmacRequest>,
) -> Response {
    use base64::Engine;
    use hmac::Mac;
    let key_bytes = match base64::engine::general_purpose::STANDARD.decode(&body.key) {
        Ok(b) => b,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid base64 key: {e}")),
    };
    let data = match base64::engine::general_purpose::STANDARD.decode(&body.data) {
        Ok(b) => b,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid base64 data: {e}")),
    };

    macro_rules! hmac_compute {
        ($hasher:path) => {{
            type H = hmac::Hmac<$hasher>;
            match H::new_from_slice(&key_bytes) {
                Ok(mut mac) => {
                    mac.update(&data);
                    mac.finalize().into_bytes().to_vec()
                }
                Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
            }
        }};
    }

    let bytes: Vec<u8> = match body.algorithm.to_ascii_lowercase().as_str() {
        "sha1" => hmac_compute!(sha1::Sha1),
        "sha256" => hmac_compute!(sha2::Sha256),
        "sha384" => hmac_compute!(sha2::Sha384),
        "sha512" => hmac_compute!(sha2::Sha512),
        "md5" => hmac_compute!(md5::Md5),
        other => {
            return plugin_err(
                StatusCode::BAD_REQUEST,
                &format!("unsupported hmac algorithm: {other}"),
            )
        }
    };
    Json(CryptoHmacResponse { bytes: base64::engine::general_purpose::STANDARD.encode(bytes) })
        .into_response()
}
