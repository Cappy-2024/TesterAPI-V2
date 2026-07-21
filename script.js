const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");

const playerContainer = document.getElementById("playerContainer");
const playerList = document.getElementById("playerList");


// Load all players when website opens

loadPlayers();



async function loadPlayers(){

    const { data, error } = await supabaseClient
        .from("tester_players")
        .select("user_id, username, display_name, updated_at")
        .order("username");


    if(error){

        console.error(error);

        playerList.innerHTML =
            "Failed loading players.";

        return;

    }


    playerList.innerHTML="";


    for(const player of data){

        createPlayerCard(player);

    }

}



function createPlayerCard(player){


    const card=document.createElement("div");

    card.className="playerCard";


    card.innerHTML=`

        <h3>${player.username}</h3>

        <p>${player.display_name}</p>

        <p>UserId: ${player.user_id}</p>

    `;


    card.onclick = () => {

        loadPlayer(player.user_id);
    
    };


    playerList.appendChild(card);

}



searchButton.onclick=async()=>{


    const search=searchInput.value.trim();


    if(!search){

        return;

    }


    playerContainer.innerHTML="Searching...";


    let query;


    if(/^\d+$/.test(search)){


        query=supabaseClient

            .from("tester_players")

            .select("*")

            .eq("user_id",Number(search));


    }else{


        query=supabaseClient

            .from("tester_players")

            .select("*")

            .ilike("username",`%${search}%`);

    }



    const {data,error}=await query;


    if(error){

        console.error(error);

        playerContainer.innerHTML=
            "Search failed.";

        return;

    }



    if(data.length===0){

        playerContainer.innerHTML=
            "Player not found.";

        return;

    }



    loadPlayer(data[0].user_id);


};

async function loadPlayer(userId) {

    playerContainer.innerHTML = "<p>Loading player...</p>";

    const { data, error } = await supabaseClient
        .from("tester_players")
        .select("*")
        .eq("user_id", userId)
        .single();

    if (error) {

        console.error(error);

        playerContainer.innerHTML = "<p>Failed to load player.</p>";

        return;
    }

    displayPlayer(data);
}

function displayPlayer(player) {

    const save = player.player_data;

    playerContainer.innerHTML = `

        <h2>${player.username}</h2>

        <hr>

        <div class="summaryGrid">

            <div class="summaryCard">
                <h3>Version</h3>
                <p>${save.Version}</p>
            </div>

            <div class="summaryCard">
                <h3>Global XP</h3>
                <p>${save.GlobalXP.toLocaleString()}</p>
            </div>

            <div class="summaryCard">
                <h3>Plasma</h3>
                <p>${save.Plasma.toLocaleString()}</p>
            </div>

            <div class="summaryCard">
                <h3>Current Game</h3>
                <p>${save.CurrentGame ?? "None"}</p>
            </div>

        </div>

        <br>

        <strong>Display Name:</strong> ${player.display_name}<br>

        <strong>UserId:</strong> ${player.user_id}<br>

        <strong>Updated:</strong> ${new Date(player.updated_at).toLocaleString()}

        <div id="gamemodeContainer"></div>

    `;

    renderGamemodes(save);

}
