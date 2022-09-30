use std::io;
use std::io::Write;

fn main() -> std::io::Result<()> {
    let username = "Simba";

    welcome2();

    print!("\n  Initializing your system. Please wait...");
    io::stdout().flush();
    sleep(2000);
    
    print!("\n\n  Auto-detecting the location of your Nexa data directory...");
    io::stdout().flush();
    sleep(3000);

    println!("\n\n  Found it!");
    println!(r"  👉 C:\Users\{}\AppData\Roaming\nexa-data", username);
    println!();
  
    println!("  _______________________________________________________________________________\n");
    println!("    Please enter your mining parameters below.");
    println!("    Will this appear directly under?");
    println!("  _______________________________________________________________________________");

    println!("\n  Type (help) for a list of options.");

    print!("\n  Enter your Nexa (destination) address: ");
    io::stdout().flush();

    let mut nexa_address = String::new();
    io::stdin().read_line(&mut nexa_address);
    // let mut a: i32 = a.trim().parse().unwrap();
    // nexa_address = nexa_address.trim().parse().unwrap();

    print!("\n  Where would you like your email alerts? (leave empty for no alerts): ");
    io::stdout().flush();

    let mut email_address = String::new();
    io::stdin().read_line(&mut email_address);
    // email_address = email_address.trim().parse().unwrap();  

    print!("\n  Your Nexa address is     : {}", nexa_address);
    println!("  Your email address is    : {}", email_address);

    println!("  Okay, we're all set .. Let's GO!");
    println!("  🙌 🚀 🤑\n");
    
    Ok(())
}


use std::{thread, time};

pub fn sleep(dur: u64) {
    let ten_millis = time::Duration::from_millis(dur);
    let now = time::Instant::now();
    
    thread::sleep(ten_millis);
    
    assert!(now.elapsed() >= ten_millis);
}

fn welcome1() {
    println!(r"
   _   _                  ____            _        _ 
  | \ | | _____  ____ _  |  _ \ ___   ___| | _____| |
  |  \| |/ _ \ \/ / _` | | |_) / _ \ / __| |/ / __| |
  | |\  |  __/>  < (_| | |  _ < (_) | (__|   <\__ \_|
  |_| \_|\___/_/\_\__,_| |_| \_\___/ \___|_|\_\___(_)
                    ____              __  __ _                 
                   |  _ \ _ __ ___   |  \/  (_)_ __   ___ _ __ 
                   | |_) | '__/ _ \  | |\/| | | '_ \ / _ \ '__|
                   |  __/| | | (_) | | |  | | | | | |  __/ |   
                   |_|   |_|  \___/  |_|  |_|_|_| |_|\___|_|   
                                       v20.9.30 (alpha)");
}

fn welcome2() {
    println!(r"

███╗   ██╗███████╗██╗  ██╗ █████╗     ██████╗  ██████╗  ██████╗██╗  ██╗███████╗██╗
████╗  ██║██╔════╝╚██╗██╔╝██╔══██╗    ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██╔════╝██║
██╔██╗ ██║█████╗   ╚███╔╝ ███████║    ██████╔╝██║   ██║██║     █████╔╝ ███████╗██║
██║╚██╗██║██╔══╝   ██╔██╗ ██╔══██║    ██╔══██╗██║   ██║██║     ██╔═██╗ ╚════██║╚═╝
██║ ╚████║███████╗██╔╝ ██╗██║  ██║    ██║  ██║╚██████╔╝╚██████╗██║  ██╗███████║██╗
╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝

       ██████╗ ██████╗  ██████╗     ███╗   ███╗██╗███╗   ██╗███████╗██████╗ 
       ██╔══██╗██╔══██╗██╔═══██╗    ████╗ ████║██║████╗  ██║██╔════╝██╔══██╗
       ██████╔╝██████╔╝██║   ██║    ██╔████╔██║██║██╔██╗ ██║█████╗  ██████╔╝
       ██╔═══╝ ██╔══██╗██║   ██║    ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██╔══██╗
       ██║     ██║  ██║╚██████╔╝    ██║ ╚═╝ ██║██║██║ ╚████║███████╗██║  ██║
       ╚═╝     ╚═╝  ╚═╝ ╚═════╝     ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝
                                               v20.9.30 (alpha)");
}
