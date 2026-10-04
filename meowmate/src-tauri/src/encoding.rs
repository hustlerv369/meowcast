// Shared encoding for service integration authentication.
pub(crate) fn base64_for(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}
#[cfg(test)]
mod tests {
    use super::base64_for;
    #[test]
    fn base64_matches_rfc4648_vectors() {
        for (plain,encoded) in [("",""),("f","Zg=="),("fo","Zm8="),("foo","Zm9v"),("foob","Zm9vYg=="),("fooba","Zm9vYmE="),("foobar","Zm9vYmFy")] {
            assert_eq!(base64_for(plain.as_bytes()),encoded);
        }
    }
}
