const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const playerContainer = document.getElementById("playerContainer");

searchButton.onclick = async () => {

    const search = searchInput.value.trim();

    if (!search) {
        return;
    }

    playerContainer.innerHTML = "<p>Searching...</p>";

    let query;

    if (/^\d+$/.test(search)) {

        query = supabase
            .from("tester_players")
            .select("*")
            .eq("user_id", Number(search))
            .single();

    } else {

        query = supabase
            .from("tester_players")
            .select("*")
            .ilike("username", search)
            .single();

    }

    const { data, error } = await query;

    if (error) {

        playerContainer.innerHTML = "<p>Player not found.</p>";

        console.error(error);

        return;

    }

    playerContainer.innerHTML = `
        <h2>${data.username}</h2>

        <p><strong>Display Name:</strong> ${data.display_name}</p>

        <p><strong>UserId:</strong> ${data.user_id}</p>

        <p><strong>Last Updated:</strong> ${data.updated_at}</p>
    `;

};
