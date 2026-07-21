const searchInput = document.getElementById("searchInput");

const searchButton = document.getElementById("searchButton");

searchButton.onclick = () => {

    const text = searchInput.value.trim();

    if(text.length === 0){

        alert("Enter a username or UserId.");

        return;

    }

    console.log(text);

};
