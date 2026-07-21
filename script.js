import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");

const playerContainer = document.getElementById("playerContainer");
const playerList = document.getElementById("playerList");


// Load all players when website opens

loadPlayers();



async function loadPlayers(){

    const {data,error} = await supabaseClient
        .from("tester_players")
        .select("*")
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


    card.onclick=()=>{

        displayPlayer(player);

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



    displayPlayer(data[0]);


};



function displayPlayer(player){


    playerContainer.innerHTML=`

        <h2>${player.username}</h2>

        <p>
        Display Name:
        ${player.display_name}
        </p>


        <p>
        UserId:
        ${player.user_id}
        </p>


        <p>
        Last Updated:
        ${new Date(player.updated_at).toLocaleString()}
        </p>

    `;


}
