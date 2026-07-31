use futures::executor::block_on;
use pi::sdk::{AgentEvent, AgentSessionHandle, SessionOptions, create_agent_session};
use std::env;

fn main() -> pi::sdk::Result<()> {
    if env::var_os("PI_SPIKE_RUN").is_none() {
        println!("Pi SDK spike compiled successfully; set PI_SPIKE_RUN=1 to execute a prompt.");
        return Ok(());
    }

    let working_directory = env::current_dir().ok();
    let provider = env::var("PI_PROVIDER").ok();
    let model = env::var("PI_MODEL").ok();
    let api_key = env::var("PI_API_KEY")
        .ok()
        .or_else(|| env::var("OPENAI_API_KEY").ok());
    let prompt =
        env::var("PI_SPIKE_PROMPT").unwrap_or_else(|_| "Reply with the word ready.".to_string());

    let mut session = block_on(create_agent_session(SessionOptions {
        provider,
        model,
        api_key,
        working_directory,
        no_session: true,
        ..SessionOptions::default()
    }))?;

    if env::var_os("PI_SPIKE_ABORT").is_some() {
        let (abort_handle, abort_signal) = AgentSessionHandle::new_abort_handle();
        abort_handle.abort();
        let result = block_on(session.prompt_with_abort(prompt, abort_signal, print_event));
        println!("abort result: {result:?}");
        return Ok(());
    }

    let message = block_on(session.prompt(prompt, print_event))?;
    println!("assistant message: {message:#?}");
    Ok(())
}

fn print_event(event: AgentEvent) {
    println!("event: {event:?}");
}
