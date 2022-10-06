use std::str::FromStr;
// use secp256k1::{PublicKey, SecretKey};
// use hex_literal::hex;
use sha2::{Sha256, Digest};
use double_sha256::{DoubleHash256};


// pub fn test_shnorr() {
//     let message = hex::decode("0x9d053626d3531e30af745789c150f7c339ec9c4ae44c2b3d09718dea4d073763");
//     let sk = secp256k1::SecretKey::from_str("2c15def15c417f0c59320433622894f277ca4555a8804ea7e7a3b6c08b9ff740").unwrap();
//     let signature = rust_schnorr::sign_message(&sk, &message);

//     println!("\nSignature: {:?}", signature);
// }

pub fn test_sha256() {
    // let base2: i32 = 2;
    // let total_size = base2.pow(24)rust_schnorr;
    // let mut data = vec![0u8;total_size as usize];
    // let mut data = b"ed35a1d27d9081cb4bf5fded7e16142878b6af86ab0ad5bc90cf9753d242f0d5191A6D40";

    /* Set header commitment. */
    let header_commitment: Vec<u8> = hex::decode("629235413ec743cc2d3e8e3dc0b298838262f71fb353f294f2cdd31b85ffe009")
        .expect("Oops! Invalid hex string.");
    println!("\nheader_commitment: {:?}", header_commitment);

    let message = "hello world";
    println!("\nmessage {}: ", message);
    let header_commitment = "c70b1d1b5e8f2eae220b7ee55d194a3b48820cfa1c58fe7a4c934603805d10b6";

    // let double_hasher = DoubleHash256::new_with_prefix(message.as_bytes());
    let double_hasher = DoubleHash256::new_with_prefix(header_commitment);
    let double_hash = double_hasher.finalize();
    println!("\ndouble_hash {:x}: ", double_hash);

    let hasher_one = Sha256::new_with_prefix(header_commitment.as_bytes());
    let hash_one = hasher_one.finalize();
    let hasher_two = Sha256::new_with_prefix(hash_one);
    let hash_two = hasher_two.finalize();
    println!("\nhash_one {:x}: ", hash_one);
    println!("\nhash_two {:x}: ", hash_two);

    assert_eq!(double_hash, hash_two);

    // let mut nonce = hex::decode("191A6D40");
    // let mut hasher1 = Sha256::new();
    // let mut hasher2 = Sha256::new();
    // let mut hasher3 = Sha256::new();
    // hasher1.update(&header_commitment);

    // hasher2.update(&hasher1);
    // let result2 = hasher2.finalize();
    // println!("\nFinal hash: {:x}", result2);

    // hasher.update(b);
    // hasher.(b"d28c4e36ec126b28b589b4cfcbd413984a8fdf8094248235fd90e0de2d8a0365");
    // hasher.update(b"8913d2c4378af4a794358ec7d458ee2bb3cfccda4bc9978e09226dabce150a14");
    // hasher.update(header_commitment);
    // let result1 = hasher1.finalize();
    // println!("\nSHA-256 before write: {:x}", result1);

    // hasher3.update(&mid);
    // let result3 = hasher3.finalize();
    // println!("\nFinal hash TWO: {:x}", result3);

}